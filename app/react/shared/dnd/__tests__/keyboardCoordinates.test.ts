/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the single-step keyboard DnD helpers ([N]).
 *
 * These functions consume raw @dnd-kit collision context (rects + container
 * ids), so they can be exercised with SYNTHETIC rectangles — no real DOM
 * layout is needed (jsdom does not compute geometry). We assert the two
 * behaviors the finding requires:
 *   - `rowPreferringCollisionDetection` resolves to an individual ROW
 *     (numeric id) rather than the enclosing CONTAINER (string id) whenever the
 *     drag overlaps a row, and never collides the active item with itself.
 *   - `singleStepKeyboardCoordinates` moves to the nearest adjacent row in the
 *     pressed direction (one row per press) using dnd-kit's TOP-LEFT coordinate
 *     convention, advancing ONLY along the pressed axis (zero drift on the
 *     preserved axis), skips containers, and returns `undefined` at the ends /
 *     for non-arrow keys.
 *
 * Regression guard: the getter must return coordinates in the same top-left
 * reference that dnd-kit's KeyboardSensor measures the drag delta against
 * (`currentCoordinates = { x: collisionRect.left, y: collisionRect.top }`).
 * Returning a row *centre* injected a +width/2 delta on the preserved axis; on
 * the wide backlog rows that ~+387px horizontal drift pushed a vertical move
 * out of the backlog column and into the sprint column, so the drop landed on
 * a sprint row (the story silently gained a `milestone_id`). The tests below
 * lock the drift-free, single-axis behaviour.
 */

import { KeyboardCode } from "@dnd-kit/core";
import type {
    ClientRect,
    CollisionDetection,
    KeyboardCoordinateGetter,
    UniqueIdentifier,
} from "@dnd-kit/core";

import {
    rowPreferringCollisionDetection,
    singleStepKeyboardCoordinates,
} from "../keyboardCoordinates";

/* -------------------------------------------------------------------------- */
/* Rect / arg factories                                                       */
/* -------------------------------------------------------------------------- */

/** Build a ClientRect from top/height (+ optional left/width). */
function rect(top: number, height: number, left = 0, width = 100): ClientRect {
    return { top, left, right: left + width, bottom: top + height, width, height };
}

type CollisionArgs = Parameters<CollisionDetection>[0];

/** Assemble the CollisionDetection args object from a compact description. */
function collisionArgs(desc: {
    activeId: UniqueIdentifier;
    ids: UniqueIdentifier[];
    rects: Map<UniqueIdentifier, ClientRect>;
    collisionRect: ClientRect;
    pointerCoordinates?: { x: number; y: number } | null;
}): CollisionArgs {
    return {
        active: { id: desc.activeId },
        collisionRect: desc.collisionRect,
        droppableRects: desc.rects,
        droppableContainers: desc.ids.map((id) => ({ id })),
        pointerCoordinates: desc.pointerCoordinates ?? null,
    } as unknown as CollisionArgs;
}

type GetterArgs = Parameters<KeyboardCoordinateGetter>[1];

/** Assemble the keyboard-getter context from a compact description. */
function getterContext(desc: {
    activeId: UniqueIdentifier | null;
    entries: Array<{ id: UniqueIdentifier; disabled?: boolean }>;
    rects: Map<UniqueIdentifier, ClientRect>;
    collisionRect: ClientRect | null;
    /** The droppable dnd-kit currently reports as `over` (drives multi-step). */
    overId?: UniqueIdentifier | null;
}): GetterArgs {
    const enabled = desc.entries.map((e) => ({ id: e.id, disabled: Boolean(e.disabled) }));
    return {
        context: {
            active: desc.activeId == null ? null : { id: desc.activeId },
            collisionRect: desc.collisionRect,
            droppableRects: desc.rects,
            droppableContainers: { getEnabled: () => enabled },
            over: desc.overId == null ? null : { id: desc.overId },
        },
    } as unknown as GetterArgs;
}

/** A synthetic keyboard event carrying only what the getter reads. */
function keyEvent(code: string): KeyboardEvent & { preventDefault: jest.Mock } {
    return { code, preventDefault: jest.fn() } as unknown as KeyboardEvent & {
        preventDefault: jest.Mock;
    };
}

/* A shared vertical backlog: container "backlog" (0..300) enclosing three
 * stacked rows 1000/1001/1002, each 100px tall. */
function verticalLayout(): Map<UniqueIdentifier, ClientRect> {
    return new Map<UniqueIdentifier, ClientRect>([
        ["backlog", rect(0, 300)],
        [1000, rect(0, 100)],
        [1001, rect(100, 100)],
        [1002, rect(200, 100)],
    ]);
}

/* -------------------------------------------------------------------------- */
/* rowPreferringCollisionDetection                                            */
/* -------------------------------------------------------------------------- */

describe("rowPreferringCollisionDetection", () => {
    it("resolves to the overlapped ROW (numeric id), not the container, for keyboard drags", () => {
        // Keyboard drag => no pointer coordinates => rectIntersection fallback.
        const result = rowPreferringCollisionDetection(
            collisionArgs({
                activeId: 1000,
                ids: ["backlog", 1001, 1002],
                rects: verticalLayout(),
                // Dragged rect centered over row 1001 (90..190, center 140).
                collisionRect: rect(90, 100),
                pointerCoordinates: null,
            }),
        );
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].id).toBe(1001);
    });

    it("falls back to the CONTAINER when the drag overlaps no row", () => {
        const rects = new Map<UniqueIdentifier, ClientRect>([
            ["backlog", rect(0, 300)],
            [1001, rect(0, 50)],
        ]);
        const result = rowPreferringCollisionDetection(
            collisionArgs({
                activeId: 1000,
                ids: ["backlog", 1001],
                rects,
                // 100..150 — inside the container but below the only row (0..50).
                collisionRect: rect(100, 50),
                pointerCoordinates: null,
            }),
        );
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].id).toBe("backlog");
    });

    it("never collides the active row with itself", () => {
        const result = rowPreferringCollisionDetection(
            collisionArgs({
                activeId: 1001,
                ids: ["backlog", 1000, 1002],
                rects: verticalLayout(),
                // 190..290 overlaps its own row 1001 AND row 1002 — must pick 1002.
                collisionRect: rect(190, 100),
                pointerCoordinates: null,
            }),
        );
        expect(result.map((c) => c.id)).not.toContain(1001);
        expect(result[0].id).toBe(1002);
    });

    it("prefers the pointed-at row when pointer coordinates are present", () => {
        const result = rowPreferringCollisionDetection(
            collisionArgs({
                activeId: 1000,
                ids: ["backlog", 1001, 1002],
                rects: verticalLayout(),
                collisionRect: rect(100, 100),
                // Pointer inside row 1001 (y=150) — also inside the container.
                pointerCoordinates: { x: 50, y: 150 },
            }),
        );
        expect(result[0].id).toBe(1001);
    });

    it("stays in the pointed-at column even when a row in the OTHER column is nearer by center ([14])", () => {
        // Two side-by-side columns (the ~800px Playwright viewport puts the
        // sprint taskboard immediately right of the backlog): the BACKLOG on the
        // left (x 0..100) with rows 1000/1001, and a SPRINT on the right
        // (x 200..300) with rows 116/117. The pointer is squarely inside backlog
        // row 1000, but the dragged `collisionRect`'s CENTRE sits over sprint row
        // 116. The previous implementation computed `closestCenter` over EVERY
        // row, so the center-nearest SPRINT row won and a backlog reorder silently
        // dropped into the sprint (the [14] "reorder multiple us" failure: the
        // block gained a `milestone_id`). The collision MUST resolve to the row
        // the pointer is actually over (backlog 1000), never the center-nearest
        // row in the column the pointer never entered.
        const twoColumns = new Map<UniqueIdentifier, ClientRect>([
            ["backlog", rect(0, 300, 0, 100)],
            [1000, rect(0, 100, 0, 100)], // backlog row, center (50,50)
            [1001, rect(100, 100, 0, 100)], // backlog row, center (50,150)
            ["milestone:8", rect(0, 300, 200, 100)],
            [116, rect(0, 100, 200, 100)], // sprint row, center (250,50)
            [117, rect(100, 100, 200, 100)], // sprint row, center (250,150)
        ]);
        const result = rowPreferringCollisionDetection(
            collisionArgs({
                activeId: 1001, // the physically-dragged backlog row
                ids: ["backlog", 1000, "milestone:8", 116, 117],
                rects: twoColumns,
                // Overlay dragged toward the right column: center (250,50) is
                // nearest to sprint row 116, tempting the old all-rows closestCenter.
                collisionRect: rect(0, 100, 200, 100),
                // Pointer squarely inside backlog row 1000 (and the backlog container).
                pointerCoordinates: { x: 50, y: 50 },
            }),
        );
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].id).toBe(1000);
        expect(result.map((c) => c.id)).not.toContain(116);
    });
});

/* -------------------------------------------------------------------------- */
/* singleStepKeyboardCoordinates                                              */
/* -------------------------------------------------------------------------- */

describe("singleStepKeyboardCoordinates", () => {
    it("steps DOWN to the immediately-next row (top-left, x preserved)", () => {
        const coords = singleStepKeyboardCoordinates(
            keyEvent(KeyboardCode.Down),
            getterContext({
                activeId: 1000,
                entries: [{ id: "backlog" }, { id: 1000 }, { id: 1001 }, { id: 1002 }],
                rects: verticalLayout(),
                collisionRect: rect(0, 100), // currently over row 1000 (top 0, left 0)
            }),
        );
        // Vertical move => x preserved at collisionRect.left (0), y at target
        // row 1001's TOP (100). This yields a pure +100 vertical delta and a
        // zero horizontal delta against dnd-kit's { left, top } reference.
        expect(coords).toEqual({ x: 0, y: 100 });
    });

    it("steps UP to the immediately-previous row (top-left, x preserved)", () => {
        const coords = singleStepKeyboardCoordinates(
            keyEvent(KeyboardCode.Up),
            getterContext({
                activeId: 1002,
                entries: [{ id: "backlog" }, { id: 1000 }, { id: 1001 }, { id: 1002 }],
                rects: verticalLayout(),
                collisionRect: rect(200, 100), // currently over row 1002 (top 200, left 0)
            }),
        );
        expect(coords).toEqual({ x: 0, y: 100 }); // row 1001 TOP, x preserved
    });

    it("advances PAST the currently-`over` row so repeated presses walk multiple rows", () => {
        // Regression for the DragOverlay multi-step bug: `collisionRect` is
        // re-derived from the overlay each press and can pin to its start, so the
        // nearest candidate stays constant. dnd-kit's `over` DOES advance (it is
        // resolved from the translated overlay), so when the closest candidate is
        // the row we are already `over`, the getter must step to the next-closest
        // collision. Here the drag started on row 1002 (collisionRect pinned at
        // top 200) and dnd-kit already reports `over: 1001` (the row directly
        // above). The nearest Up candidate is 1001 — but since that IS the
        // current `over`, the getter must return the NEXT row up, 1000 (top 0),
        // not 1001 (top 100). Without the `over` step this would return 1001
        // forever and the item could never move more than one row.
        const coords = singleStepKeyboardCoordinates(
            keyEvent(KeyboardCode.Up),
            getterContext({
                activeId: 1002,
                entries: [{ id: "backlog" }, { id: 1000 }, { id: 1001 }, { id: 1002 }],
                rects: verticalLayout(),
                collisionRect: rect(200, 100), // pinned over row 1002's start
                overId: 1001, // already hovering the row directly above
            }),
        );
        expect(coords).toEqual({ x: 0, y: 0 }); // stepped past 1001 to row 1000's TOP
    });

    it("does NOT skip a row when `over` is the container (not yet on an adjacent row)", () => {
        // On the very first press `over` is typically the enclosing container,
        // not a sibling row. In that case the closest candidate is NOT the
        // `over`, so the getter returns the immediately-adjacent row (no skip).
        const coords = singleStepKeyboardCoordinates(
            keyEvent(KeyboardCode.Up),
            getterContext({
                activeId: 1002,
                entries: [{ id: "backlog" }, { id: 1000 }, { id: 1001 }, { id: 1002 }],
                rects: verticalLayout(),
                collisionRect: rect(200, 100),
                overId: "backlog", // hovering the container, not a row
            }),
        );
        expect(coords).toEqual({ x: 0, y: 100 }); // adjacent row 1001, no skip
    });

    it("returns undefined at the end of the list (no row below)", () => {
        const coords = singleStepKeyboardCoordinates(
            keyEvent(KeyboardCode.Down),
            getterContext({
                activeId: 1002,
                entries: [{ id: "backlog" }, { id: 1000 }, { id: 1001 }, { id: 1002 }],
                rects: verticalLayout(),
                collisionRect: rect(200, 100), // last row, nothing below
            }),
        );
        expect(coords).toBeUndefined();
    });

    it("ignores non-arrow keys without preventing default", () => {
        const event = keyEvent(KeyboardCode.Space);
        const coords = singleStepKeyboardCoordinates(
            event,
            getterContext({
                activeId: 1000,
                entries: [{ id: 1000 }, { id: 1001 }],
                rects: verticalLayout(),
                collisionRect: rect(0, 100),
            }),
        );
        expect(coords).toBeUndefined();
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("prevents default page scroll for arrow keys", () => {
        const event = keyEvent(KeyboardCode.Down);
        singleStepKeyboardCoordinates(
            event,
            getterContext({
                activeId: 1000,
                entries: [{ id: 1000 }, { id: 1001 }, { id: 1002 }],
                rects: verticalLayout(),
                collisionRect: rect(0, 100),
            }),
        );
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it("skips container droppables even when one lies nearer in the pressed direction", () => {
        // A container "sprint:9" sits at top 50 (nearer than row 1001 at top 100).
        // If containers were not excluded it would win; the row must win instead.
        const rects = new Map<UniqueIdentifier, ClientRect>([
            ["backlog", rect(0, 300)],
            ["sprint:9", rect(50, 100)],
            [1000, rect(0, 100)],
            [1001, rect(100, 100)],
            [1002, rect(200, 100)],
        ]);
        const coords = singleStepKeyboardCoordinates(
            keyEvent(KeyboardCode.Down),
            getterContext({
                activeId: 1000,
                entries: [
                    { id: "backlog" },
                    { id: "sprint:9" },
                    { id: 1000 },
                    { id: 1001 },
                    { id: 1002 },
                ],
                rects,
                collisionRect: rect(0, 100),
            }),
        );
        // Row 1001's TOP (y 100), x preserved at 0 — NOT sprint:9 (a container).
        expect(coords).toEqual({ x: 0, y: 100 });
    });

    it("steps RIGHT to the next column row (top-left, y preserved)", () => {
        const rects = new Map<UniqueIdentifier, ClientRect>([
            [2000, rect(0, 100, 0, 100)],
            [2001, rect(0, 100, 100, 100)],
            [2002, rect(0, 100, 200, 100)],
        ]);
        const coords = singleStepKeyboardCoordinates(
            keyEvent(KeyboardCode.Right),
            getterContext({
                activeId: 2000,
                entries: [{ id: 2000 }, { id: 2001 }, { id: 2002 }],
                rects,
                collisionRect: rect(0, 100, 0, 100),
            }),
        );
        // Horizontal move => y preserved at collisionRect.top (0), x at target
        // column 2001's LEFT (100).
        expect(coords).toEqual({ x: 100, y: 0 });
    });

    it("returns undefined when there is no active drag or collision rect", () => {
        expect(
            singleStepKeyboardCoordinates(
                keyEvent(KeyboardCode.Down),
                getterContext({
                    activeId: null,
                    entries: [{ id: 1000 }, { id: 1001 }],
                    rects: verticalLayout(),
                    collisionRect: rect(0, 100),
                }),
            ),
        ).toBeUndefined();

        expect(
            singleStepKeyboardCoordinates(
                keyEvent(KeyboardCode.Down),
                getterContext({
                    activeId: 1000,
                    entries: [{ id: 1000 }, { id: 1001 }],
                    rects: verticalLayout(),
                    collisionRect: null,
                }),
            ),
        ).toBeUndefined();
    });

    /* ---------------------------------------------------------------------- */
    /* Regression: wide backlog column beside a sprint column (live geometry)  */
    /* ---------------------------------------------------------------------- */

    /*
     * Reproduces the production layout that surfaced the bug:
     *   - Backlog is the LEFT column: wide rows at left=216, width=774.
     *   - Sprints are the RIGHT column: rows at left=1006, width=258.
     * A vertical (Up/Down) keyboard step on a backlog row must keep the drag
     * reference in the backlog column. The pre-fix centre-return produced
     * x = 216 + 774/2 = 603, which — measured as a delta against dnd-kit's
     * { left: 216 } reference — was a +387px horizontal drift that pushed the
     * dragged rect's centre (603 + 387 = 990) up against the sprint column
     * (left=1006), so the drop resolved onto a sprint row. The fix preserves x.
     */
    const BACKLOG_LEFT = 216;
    const BACKLOG_WIDTH = 774;
    const SPRINT_LEFT = 1006;
    const SPRINT_WIDTH = 258;

    function backlogBesideSprintLayout(): Map<UniqueIdentifier, ClientRect> {
        return new Map<UniqueIdentifier, ClientRect>([
            // Backlog container + three stacked wide rows (86px pitch).
            ["backlog", rect(578, 300, BACKLOG_LEFT, BACKLOG_WIDTH)],
            [71, rect(578, 80, BACKLOG_LEFT, BACKLOG_WIDTH)],
            [72, rect(664, 80, BACKLOG_LEFT, BACKLOG_WIDTH)],
            [73, rect(750, 80, BACKLOG_LEFT, BACKLOG_WIDTH)],
            // Sprint container + a sprint story row in the right column.
            ["sprint:7", rect(125, 487, SPRINT_LEFT, SPRINT_WIDTH)],
            [55, rect(200, 60, SPRINT_LEFT, SPRINT_WIDTH)],
        ]);
    }

    it("keeps a vertical backlog step inside the backlog column (no sprint drift)", () => {
        const collisionRect = rect(750, 80, BACKLOG_LEFT, BACKLOG_WIDTH); // over row 73
        const coords = singleStepKeyboardCoordinates(
            keyEvent(KeyboardCode.Up),
            getterContext({
                activeId: 73,
                entries: [
                    { id: "backlog" },
                    { id: 71 },
                    { id: 72 },
                    { id: 73 },
                    { id: "sprint:7" },
                    { id: 55 },
                ],
                rects: backlogBesideSprintLayout(),
                collisionRect,
            }),
        );
        expect(coords).not.toBeUndefined();
        // x MUST stay at the backlog column's left (no horizontal drift toward
        // the sprint column). y advances to the adjacent backlog row 72's top.
        expect(coords).toEqual({ x: BACKLOG_LEFT, y: 664 });

        // Verify the delta dnd-kit will apply (newCoords - { left, top }) is
        // purely vertical: zero horizontal component => the dragged rect cannot
        // migrate into the sprint column.
        const deltaX = coords!.x - collisionRect.left;
        const deltaY = coords!.y - collisionRect.top;
        expect(deltaX).toBe(0);
        expect(deltaY).toBe(664 - 750); // exactly one row up

        // Translated collision rect stays fully left of the sprint column.
        const translatedRight = collisionRect.right + deltaX;
        expect(translatedRight).toBeLessThan(SPRINT_LEFT);
    });
});
