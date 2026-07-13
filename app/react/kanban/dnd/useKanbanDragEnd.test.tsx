/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { DragEndEvent } from "@dnd-kit/core";

import { createKanbanDragEndHandler } from "./index";
import type { KanbanDragEndContext, KanbanDropArgs } from "./types";
import type { UserStory } from "../../shared/types";

const story = (id: number, status: number, swimlane: number | null): UserStory =>
    ({ id, status, swimlane } as UserStory);

const baseUsMap: Record<number, UserStory> = {
    1: story(1, 10, null),
    2: story(2, 10, null),
    3: story(3, 10, null),
    4: story(4, 20, null),
    5: story(5, 20, null),
};

const makeContext = (
    selectedUss: Record<number, boolean>,
    handleDragEnd: (args: KanbanDropArgs) => void,
): KanbanDragEndContext => ({
    usByStatus: {},
    usByStatusSwimlanes: {},
    usMap: baseUsMap,
    selectedUss,
    swimlanesList: [],
    handleDragEnd,
});

const makeEvent = (
    activeId: number,
    over: { statusId: number; swimlaneId: number | null } | null,
    deltaY: number,
): DragEndEvent =>
    ({
        active: { id: activeId, data: { current: { type: "card", usId: activeId } } },
        over:
            over === null
                ? null
                : {
                      id: `column:${over.statusId}:${over.swimlaneId ?? "none"}`,
                      data: {
                          current: {
                              type: "column",
                              statusId: over.statusId,
                              swimlaneId: over.swimlaneId,
                          },
                      },
                  },
        delta: { x: 0, y: deltaY },
    }) as unknown as DragEndEvent;

const stubRect = (selector: string, top: number, height: number): void => {
    const el = document.querySelector(selector);

    if (el !== null) {
        (el as HTMLElement).getBoundingClientRect = (): DOMRect =>
            ({
                top,
                height,
                bottom: top + height,
                left: 0,
                right: 0,
                width: 0,
                x: 0,
                y: top,
                toJSON: () => ({}),
            }) as DOMRect;
    }
};

const buildBoard = (): void => {
    document.body.innerHTML =
        '<div class="kanban-uses-box taskboard-column" data-status="10">' +
        '<tg-card data-id="1"></tg-card>' +
        '<tg-card data-id="2"></tg-card>' +
        '<tg-card data-id="3"></tg-card>' +
        "</div>" +
        '<div class="kanban-uses-box taskboard-column" data-status="20">' +
        '<tg-card data-id="4"></tg-card>' +
        '<tg-card data-id="5"></tg-card>' +
        "</div>";

    stubRect('tg-card[data-id="1"]', 0, 40);
    stubRect('tg-card[data-id="2"]', 40, 40);
    stubRect('tg-card[data-id="3"]', 80, 40);
    stubRect('tg-card[data-id="4"]', 0, 40);
    stubRect('tg-card[data-id="5"]', 40, 40);
};

describe("createKanbanDragEndHandler", () => {
    beforeEach(() => {
        buildBoard();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("moves a card across columns, resolving previousCard from the target order", () => {
        const onDrop = jest.fn();
        const handler = createKanbanDragEndHandler(makeContext({}, () => undefined), onDrop);

        // card2 (mid 60) into column 20; deltaY -10 -> pointerY 50 (between card4=20 and card5=60)
        handler(makeEvent(2, { statusId: 20, swimlaneId: null }, -10));

        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(onDrop.mock.calls[0][0]).toEqual({
            usList: [2],
            statusId: 20,
            swimlaneId: null,
            index: 1,
            previousCard: 4,
            nextCard: null,
        });
    });

    it("drops at the front of a column -> previousCard null, nextCard = first card", () => {
        const onDrop = jest.fn();
        const handler = createKanbanDragEndHandler(makeContext({}, () => undefined), onDrop);

        // card2 (mid 60) to top of column 20; deltaY -50 -> pointerY 10 (above card4=20)
        handler(makeEvent(2, { statusId: 20, swimlaneId: null }, -50));

        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(onDrop.mock.calls[0][0]).toEqual({
            usList: [2],
            statusId: 20,
            swimlaneId: null,
            index: 0,
            previousCard: null,
            nextCard: 4,
        });
    });

    it("drops at the end of a column -> previousCard = last card, nextCard null", () => {
        const onDrop = jest.fn();
        const handler = createKanbanDragEndHandler(makeContext({}, () => undefined), onDrop);

        // card2 (mid 60) to bottom of column 20; deltaY +40 -> pointerY 100 (below card5=60)
        handler(makeEvent(2, { statusId: 20, swimlaneId: null }, 40));

        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(onDrop.mock.calls[0][0]).toEqual({
            usList: [2],
            statusId: 20,
            swimlaneId: null,
            index: 2,
            previousCard: 5,
            nextCard: null,
        });
    });

    it("reorders within the same column", () => {
        const onDrop = jest.fn();
        const handler = createKanbanDragEndHandler(makeContext({}, () => undefined), onDrop);

        // card1 (mid 20) down below card3 (mid 100); deltaY +90 -> pointerY 110
        handler(makeEvent(1, { statusId: 10, swimlaneId: null }, 90));

        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(onDrop.mock.calls[0][0]).toEqual({
            usList: [1],
            statusId: 10,
            swimlaneId: null,
            index: 2,
            previousCard: 3,
            nextCard: null,
        });
    });

    it("does nothing when dropped in place (no-op guard)", () => {
        const onDrop = jest.fn();
        const handler = createKanbanDragEndHandler(makeContext({}, () => undefined), onDrop);

        // card2 back in place: same column, deltaY 0
        handler(makeEvent(2, { statusId: 10, swimlaneId: null }, 0));

        expect(onDrop).not.toHaveBeenCalled();
    });

    it("does nothing when dropped outside any column (over = null)", () => {
        const onDrop = jest.fn();
        const handler = createKanbanDragEndHandler(makeContext({}, () => undefined), onDrop);

        handler(makeEvent(2, null, -10));

        expect(onDrop).not.toHaveBeenCalled();
    });

    it("moves the whole selection when the dragged card is selected (multi-drag)", () => {
        const onDrop = jest.fn();
        const handler = createKanbanDragEndHandler(
            makeContext({ 1: true, 3: true }, () => undefined),
            onDrop,
        );

        // drag selected card1 to the end of column 20; both 1 and 3 move (DOM order [1, 3])
        handler(makeEvent(1, { statusId: 20, swimlaneId: null }, 80));

        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(onDrop.mock.calls[0][0]).toEqual({
            usList: [1, 3],
            statusId: 20,
            swimlaneId: null,
            index: 2,
            previousCard: 5,
            nextCard: null,
        });
    });

    it("moves ONLY the dragged card when it is not part of the selection", () => {
        const onDrop = jest.fn();
        const handler = createKanbanDragEndHandler(
            makeContext({ 1: true, 3: true }, () => undefined),
            onDrop,
        );

        // drag UNSELECTED card2 to the front of column 20 -> only card2 moves
        handler(makeEvent(2, { statusId: 20, swimlaneId: null }, -50));

        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(onDrop.mock.calls[0][0]).toEqual({
            usList: [2],
            statusId: 20,
            swimlaneId: null,
            index: 0,
            previousCard: null,
            nextCard: 4,
        });
    });
});
