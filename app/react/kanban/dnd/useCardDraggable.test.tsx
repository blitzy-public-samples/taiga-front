/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { renderHook } from "@testing-library/react";

import { useCardDraggable } from "./index";

const mockUseDraggable = jest.fn();

jest.mock("@dnd-kit/core", () => {
    const actual = jest.requireActual("@dnd-kit/core");

    return {
        ...actual,
        useDraggable: (args: unknown) => mockUseDraggable(args),
    };
});

describe("useCardDraggable", () => {
    beforeEach(() => {
        mockUseDraggable.mockReset();
        mockUseDraggable.mockReturnValue({
            setNodeRef: () => undefined,
            attributes: { role: "button", tabIndex: 0 },
            listeners: { onPointerDown: () => undefined },
            isDragging: false,
            transform: null,
            node: { current: null },
        });
    });

    it("registers the card as a draggable keyed by the user-story id", () => {
        renderHook(() => useCardDraggable(42));

        expect(mockUseDraggable).toHaveBeenCalledTimes(1);
        const arg = mockUseDraggable.mock.calls[0][0];
        expect(arg.id).toBe(42);
        expect(arg.disabled).toBe(false);
        expect(arg.data).toEqual({ type: "card", usId: 42 });
    });

    it("passes through the disabled option (gating decided by the board)", () => {
        renderHook(() => useCardDraggable(7, { disabled: true }));

        const arg = mockUseDraggable.mock.calls[0][0];
        expect(arg.id).toBe(7);
        expect(arg.disabled).toBe(true);
        expect(arg.data).toEqual({ type: "card", usId: 7 });
    });

    it("defaults disabled to false when no options are provided", () => {
        renderHook(() => useCardDraggable(9));

        expect(mockUseDraggable.mock.calls[0][0].disabled).toBe(false);
    });

    it("returns only setNodeRef, attributes, listeners and isDragging (no transform)", () => {
        const { result } = renderHook(() => useCardDraggable(1));

        expect(Object.keys(result.current).sort()).toEqual([
            "attributes",
            "isDragging",
            "listeners",
            "setNodeRef",
        ]);
        expect(typeof result.current.setNodeRef).toBe("function");
        expect(result.current.attributes).toEqual({ role: "button", tabIndex: 0 });
        expect(result.current.listeners).toEqual({ onPointerDown: expect.any(Function) });
        expect(result.current.isDragging).toBe(false);
        expect("transform" in result.current).toBe(false);
    });

    it("reflects the dragging state reported by dnd-kit", () => {
        mockUseDraggable.mockReturnValue({
            setNodeRef: () => undefined,
            attributes: {},
            listeners: {},
            isDragging: true,
            transform: null,
            node: { current: null },
        });

        const { result } = renderHook(() => useCardDraggable(1));

        expect(result.current.isDragging).toBe(true);
    });
});
