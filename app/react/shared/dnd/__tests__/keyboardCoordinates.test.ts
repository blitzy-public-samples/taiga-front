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
 *   - `singleStepKeyboardCoordinates` moves to the CENTER of the nearest
 *     adjacent row in the pressed direction (one row per press), skips
 *     containers, and returns `undefined` at the ends / for non-arrow keys.
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
}): GetterArgs {
    const enabled = desc.entries.map((e) => ({ id: e.id, disabled: Boolean(e.disabled) }));
    return {
        context: {
            active: desc.activeId == null ? null : { id: desc.activeId },
            collisionRect: desc.collisionRect,
            droppableRects: desc.rects,
            droppableContainers: { getEnabled: () => enabled },
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
});

/* -------------------------------------------------------------------------- */
/* singleStepKeyboardCoordinates                                              */
/* -------------------------------------------------------------------------- */

describe("singleStepKeyboardCoordinates", () => {
    it("steps DOWN to the center of the immediately-next row", () => {
        const coords = singleStepKeyboardCoordinates(
            keyEvent(KeyboardCode.Down),
            getterContext({
                activeId: 1000,
                entries: [{ id: "backlog" }, { id: 1000 }, { id: 1001 }, { id: 1002 }],
                rects: verticalLayout(),
                collisionRect: rect(0, 100), // currently over row 1000
            }),
        );
        // Center of row 1001 (top 100, height 100) => y 150; x = 0 + 100/2.
        expect(coords).toEqual({ x: 50, y: 150 });
    });

    it("steps UP to the center of the immediately-previous row", () => {
        const coords = singleStepKeyboardCoordinates(
            keyEvent(KeyboardCode.Up),
            getterContext({
                activeId: 1002,
                entries: [{ id: "backlog" }, { id: 1000 }, { id: 1001 }, { id: 1002 }],
                rects: verticalLayout(),
                collisionRect: rect(200, 100), // currently over row 1002
            }),
        );
        expect(coords).toEqual({ x: 50, y: 150 }); // row 1001 center
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
        expect(coords).toEqual({ x: 50, y: 150 }); // row 1001 center, NOT sprint:9
    });

    it("steps RIGHT to the center of the next column row", () => {
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
        expect(coords).toEqual({ x: 150, y: 50 }); // row 2001 center
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
});
