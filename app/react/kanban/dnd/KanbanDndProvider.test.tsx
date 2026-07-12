/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { render, screen } from "@testing-library/react";

import { KanbanDndProvider } from "./index";
import type { KanbanDragEndContext } from "./index";

function makeContext(): KanbanDragEndContext {
    return {
        usByStatus: {},
        usByStatusSwimlanes: {},
        usMap: {},
        selectedUss: {},
        swimlanesList: [],
        handleDragEnd: jest.fn(),
    } as unknown as KanbanDragEndContext;
}

describe("KanbanDndProvider", () => {
    it("renders its children (enabled default)", () => {
        render(
            <KanbanDndProvider context={makeContext()}>
                <div data-testid="board-child">board</div>
            </KanbanDndProvider>,
        );

        expect(screen.getByTestId("board-child")).toBeInTheDocument();
    });

    it("renders its children when disabled", () => {
        render(
            <KanbanDndProvider context={makeContext()} enabled={false}>
                <div data-testid="board-child">board</div>
            </KanbanDndProvider>,
        );

        expect(screen.getByTestId("board-child")).toBeInTheDocument();
    });

    it("accepts an explicit onDrop without throwing", () => {
        const onDrop = jest.fn();

        render(
            <KanbanDndProvider context={makeContext()} onDrop={onDrop}>
                <div data-testid="board-child">board</div>
            </KanbanDndProvider>,
        );

        expect(screen.getByTestId("board-child")).toBeInTheDocument();
        expect(onDrop).not.toHaveBeenCalled();
    });
});
