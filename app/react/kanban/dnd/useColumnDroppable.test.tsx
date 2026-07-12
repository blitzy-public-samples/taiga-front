/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { renderHook } from "@testing-library/react";

import { useColumnDroppable } from "./index";

const mockUseDroppable = jest.fn();

jest.mock("@dnd-kit/core", () => {
    const actual = jest.requireActual("@dnd-kit/core");

    return {
        ...actual,
        useDroppable: (args: unknown) => mockUseDroppable(args),
    };
});

describe("useColumnDroppable", () => {
    beforeEach(() => {
        mockUseDroppable.mockReset();
        mockUseDroppable.mockReturnValue({
            setNodeRef: () => undefined,
            isOver: false,
            node: { current: null },
            over: null,
            rect: { current: null },
            active: null,
        });
    });

    it("keys a non-swimlane column by status id and 'none'", () => {
        renderHook(() => useColumnDroppable({ statusId: 10, swimlaneId: null }));

        expect(mockUseDroppable).toHaveBeenCalledTimes(1);
        const arg = mockUseDroppable.mock.calls[0][0];
        expect(arg.id).toBe("column:10:none");
        expect(arg.disabled).toBe(false);
        expect(arg.data).toEqual({ type: "column", statusId: 10, swimlaneId: null });
    });

    it("encodes a real swimlane id into the droppable id", () => {
        renderHook(() => useColumnDroppable({ statusId: 10, swimlaneId: 5 }));

        const arg = mockUseDroppable.mock.calls[0][0];
        expect(arg.id).toBe("column:10:5");
        expect(arg.data).toEqual({ type: "column", statusId: 10, swimlaneId: 5 });
    });

    it("encodes the unclassified swimlane (-1) distinctly from the non-swimlane column", () => {
        renderHook(() => useColumnDroppable({ statusId: 10, swimlaneId: -1 }));

        const arg = mockUseDroppable.mock.calls[0][0];
        expect(arg.id).toBe("column:10:-1");
        expect(arg.id).not.toBe("column:10:none");
        expect(arg.data).toEqual({ type: "column", statusId: 10, swimlaneId: -1 });
    });

    it("defaults the disabled option to false", () => {
        renderHook(() => useColumnDroppable({ statusId: 3, swimlaneId: null }));

        expect(mockUseDroppable.mock.calls[0][0].disabled).toBe(false);
    });

    it("passes through disabled: true", () => {
        renderHook(() => useColumnDroppable({ statusId: 3, swimlaneId: null, disabled: true }));

        expect(mockUseDroppable.mock.calls[0][0].disabled).toBe(true);
    });

    it("returns only setNodeRef and isOver", () => {
        const { result } = renderHook(() => useColumnDroppable({ statusId: 1, swimlaneId: null }));

        expect(Object.keys(result.current).sort()).toEqual(["isOver", "setNodeRef"]);
        expect(typeof result.current.setNodeRef).toBe("function");
        expect(result.current.isOver).toBe(false);
    });

    it("reflects the isOver state reported by dnd-kit (drives the target-drop class)", () => {
        mockUseDroppable.mockReturnValue({
            setNodeRef: () => undefined,
            isOver: true,
            node: { current: null },
            over: null,
            rect: { current: null },
            active: null,
        });

        const { result } = renderHook(() => useColumnDroppable({ statusId: 1, swimlaneId: null }));

        expect(result.current.isOver).toBe(true);
    });
});
