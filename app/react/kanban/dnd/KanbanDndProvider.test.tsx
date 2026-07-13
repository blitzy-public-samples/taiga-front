/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { act, render, screen } from "@testing-library/react";

import { PointerSensor, KeyboardSensor } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";

import { KanbanDndProvider as Provider } from "./index";
import type { KanbanDragEndContext, KanbanDropArgs } from "./index";
import type { UserStory } from "../../shared/types";

/* -------------------------------------------------------------------------- */
/* Mock @dnd-kit/core                                                          */
/* -------------------------------------------------------------------------- */
/* The provider is the single production drag path (M6). We replace `DndContext`
 * and `DragOverlay` with prop-capturing passthroughs so a spec can (a) read the
 * EXACT handlers/flags the provider wires, (b) invoke the captured `onDragEnd`
 * to prove the drop is forwarded to `context.handleDragEnd` through the real
 * `createKanbanDragEndHandler` + domGeometry glue, and (c) observe the
 * `DragOverlay` mirror once a drag starts. Sensor + `KanbanDndProvider` (the SUT)
 * and all other exports remain real. Captures use the `mock*` prefix so the
 * jest.mock factory may reference them (out-of-scope reference exemption). */
const mockSensorCalls: Array<{ sensor: unknown; options: unknown }> = [];
const mockCaptured: {
    props: Record<string, unknown> | null;
    history: Array<Record<string, unknown>>;
} = { props: null, history: [] };

jest.mock("@dnd-kit/core", () => {
    const actual = jest.requireActual("@dnd-kit/core");
    return {
        __esModule: true,
        ...actual,
        useSensor: (sensor: unknown, options: unknown) => {
            mockSensorCalls.push({ sensor, options });
            return { sensor, options };
        },
        useSensors: (...sensors: unknown[]) => sensors,
        DndContext: (props: Record<string, unknown>) => {
            mockCaptured.props = props;
            mockCaptured.history.push(props);
            return <div data-testid="dnd">{props.children as React.ReactNode}</div>;
        },
        DragOverlay: (props: Record<string, unknown>) => (
            <div data-testid="overlay">{props.children as React.ReactNode}</div>
        ),
    };
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */
const story = (id: number, status: number, subject: string): UserStory =>
    ({ id, status, swimlane: null, subject } as UserStory);

const usMap: Record<number, UserStory> = {
    1: story(1, 10, "First"),
    2: story(2, 10, "Second"),
    3: story(3, 10, "Third"),
    4: story(4, 20, "Fourth"),
    5: story(5, 20, "Fifth"),
};

const makeContext = (
    handleDragEnd: (args: KanbanDropArgs) => void,
): KanbanDragEndContext => ({
    usByStatus: {},
    usByStatusSwimlanes: {},
    usMap,
    selectedUss: {},
    swimlanesList: [],
    handleDragEnd,
});

const makeDragEndEvent = (
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
                      id: `column:${over.statusId}`,
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

const overlayRenderer = (id: number): React.ReactNode => (
    <tg-card data-testid="mirror" class="gu-mirror" data-id={id}>
        {usMap[id]?.subject}
    </tg-card>
);

beforeEach(() => {
    mockSensorCalls.length = 0;
    mockCaptured.props = null;
    mockCaptured.history = [];
});

afterEach(() => {
    document.body.innerHTML = "";
});

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */
describe("KanbanDndProvider", () => {
    it("renders its children (enabled default)", () => {
        render(
            <Provider context={makeContext(jest.fn())}>
                <div data-testid="board-child">board</div>
            </Provider>,
        );
        expect(screen.getByTestId("board-child")).toBeInTheDocument();
    });

    it("renders its children when disabled", () => {
        render(
            <Provider context={makeContext(jest.fn())} enabled={false}>
                <div data-testid="board-child">board</div>
            </Provider>,
        );
        expect(screen.getByTestId("board-child")).toBeInTheDocument();
    });

    it("registers BOTH a PointerSensor (5px) and a KeyboardSensor (C3)", () => {
        render(
            <Provider context={makeContext(jest.fn())}>
                <div />
            </Provider>,
        );

        const sensors = mockSensorCalls.map((c) => c.sensor);
        expect(sensors).toContain(PointerSensor);
        expect(sensors).toContain(KeyboardSensor);

        const pointer = mockSensorCalls.find((c) => c.sensor === PointerSensor);
        expect(pointer?.options).toEqual({ activationConstraint: { distance: 5 } });
    });

    it("wires drag-start/-end/-cancel handlers, autoScroll and announcements when enabled", () => {
        render(
            <Provider context={makeContext(jest.fn())}>
                <div />
            </Provider>,
        );

        const props = mockCaptured.props!;
        expect(typeof props.onDragStart).toBe("function");
        expect(typeof props.onDragEnd).toBe("function");
        expect(typeof props.onDragCancel).toBe("function");
        expect(props.autoScroll).toBe(true);
        const a11y = props.accessibility as { announcements?: Record<string, unknown> };
        expect(typeof a11y.announcements?.onDragStart).toBe("function");
        expect(typeof a11y.announcements?.onDragEnd).toBe("function");
    });

    it("is inert when disabled: no handlers, no autoScroll", () => {
        render(
            <Provider context={makeContext(jest.fn())} enabled={false}>
                <div />
            </Provider>,
        );

        const props = mockCaptured.props!;
        expect(props.onDragStart).toBeUndefined();
        expect(props.onDragEnd).toBeUndefined();
        expect(props.onDragCancel).toBeUndefined();
        expect(props.autoScroll).toBe(false);
    });

    it("forwards a resolved drop to context.handleDragEnd exactly once (default sink)", () => {
        buildBoard();
        const handleDragEnd = jest.fn();
        render(
            <Provider context={makeContext(handleDragEnd)}>
                <div />
            </Provider>,
        );

        const onDragEnd = mockCaptured.props!.onDragEnd as (e: DragEndEvent) => void;
        // Move card 2 into column 20 (pointer between card4=20 and card5=60).
        act(() => onDragEnd(makeDragEndEvent(2, { statusId: 20, swimlaneId: null }, -10)));

        expect(handleDragEnd).toHaveBeenCalledTimes(1);
        expect(handleDragEnd.mock.calls[0][0]).toMatchObject({
            usList: [2],
            statusId: 20,
            swimlaneId: null,
        });
    });

    it("forwards a resolved drop to an explicit onDrop instead of context.handleDragEnd", () => {
        buildBoard();
        const handleDragEnd = jest.fn();
        const onDrop = jest.fn();
        render(
            <Provider context={makeContext(handleDragEnd)} onDrop={onDrop}>
                <div />
            </Provider>,
        );

        const onDragEnd = mockCaptured.props!.onDragEnd as (e: DragEndEvent) => void;
        act(() => onDragEnd(makeDragEndEvent(2, { statusId: 20, swimlaneId: null }, -10)));

        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(handleDragEnd).not.toHaveBeenCalled();
    });

    it("renders the DragOverlay mirror for the active card on drag start, and clears it on end (C3)", () => {
        buildBoard();
        render(
            <Provider context={makeContext(jest.fn())} renderOverlay={overlayRenderer}>
                <div />
            </Provider>,
        );

        // No mirror before a drag starts.
        expect(screen.queryByTestId("mirror")).toBeNull();

        const onDragStart = mockCaptured.props!.onDragStart as (e: unknown) => void;
        act(() => onDragStart({ active: { id: 2 } }));

        const mirror = screen.getByTestId("mirror");
        expect(mirror).toHaveTextContent("Second");
        expect(mirror).toHaveAttribute("class", "gu-mirror");

        const onDragEnd = mockCaptured.props!.onDragEnd as (e: DragEndEvent) => void;
        act(() => onDragEnd(makeDragEndEvent(2, null, 0)));
        expect(screen.queryByTestId("mirror")).toBeNull();
    });

    it("clears the overlay when a drag is cancelled (C3)", () => {
        render(
            <Provider context={makeContext(jest.fn())} renderOverlay={overlayRenderer}>
                <div />
            </Provider>,
        );

        act(() => (mockCaptured.props!.onDragStart as (e: unknown) => void)({ active: { id: 3 } }));
        expect(screen.getByTestId("mirror")).toHaveTextContent("Third");

        act(() => (mockCaptured.props!.onDragCancel as (e: unknown) => void)({ active: { id: 3 } }));
        expect(screen.queryByTestId("mirror")).toBeNull();
    });

    it("announces pick-up / drop by the story subject (C3 a11y)", () => {
        render(
            <Provider context={makeContext(jest.fn())}>
                <div />
            </Provider>,
        );

        const a11y = mockCaptured.props!.accessibility as {
            announcements: {
                onDragStart: (a: unknown) => string | undefined;
                onDragEnd: (a: unknown) => string | undefined;
                onDragCancel: (a: unknown) => string | undefined;
            };
        };
        expect(a11y.announcements.onDragStart({ active: { id: 2 } })).toContain("Second");
        expect(
            a11y.announcements.onDragEnd({ active: { id: 2 }, over: { id: "column:20" } }),
        ).toContain("dropped");
        expect(a11y.announcements.onDragCancel({ active: { id: 2 } })).toContain("cancelled");
    });

    it("keeps a stable onDragEnd identity across context churn, but always uses the LATEST context (M6)", () => {
        buildBoard();
        const firstHandle = jest.fn();
        const { rerender } = render(
            <Provider context={makeContext(firstHandle)}>
                <div />
            </Provider>,
        );
        const firstOnDragEnd = mockCaptured.props!.onDragEnd;

        // Re-render with a brand-new context object identity (the useKanbanStories
        // return is recreated every render). The handler passed to DndContext must
        // NOT be torn down and rebuilt.
        const secondHandle = jest.fn();
        rerender(
            <Provider context={makeContext(secondHandle)}>
                <div />
            </Provider>,
        );
        const secondOnDragEnd = mockCaptured.props!.onDragEnd;
        expect(secondOnDragEnd).toBe(firstOnDragEnd);

        // A drop after the re-render dispatches to the LATEST context sink.
        act(() =>
            (secondOnDragEnd as (e: DragEndEvent) => void)(
                makeDragEndEvent(2, { statusId: 20, swimlaneId: null }, -10),
            ),
        );
        expect(secondHandle).toHaveBeenCalledTimes(1);
        expect(firstHandle).not.toHaveBeenCalled();
    });

    it("accepts an explicit onDrop without invoking it on mount", () => {
        const onDrop = jest.fn();
        render(
            <Provider context={makeContext(jest.fn())} onDrop={onDrop}>
                <div data-testid="board-child">board</div>
            </Provider>,
        );
        expect(screen.getByTestId("board-child")).toBeInTheDocument();
        expect(onDrop).not.toHaveBeenCalled();
    });
});
