/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Jest + React Testing Library suite for the shared drag-and-drop provider.
//
// It exercises the file end-to-end:
//   • the pure helpers (isDragEnabled, computeNeighbors, shouldSkip,
//     mapSwimlaneForApi, applyDrop) — these carry the ordering contract that the
//     FROZEN /api/v1 bulk-order endpoints rely on, ported from the CoffeeScript
//     sortable directives;
//   • the persister factories (createKanbanPersister / createBacklogPersister),
//     asserting the EXACT argument order and the swimlane -1 -> null mapping by
//     mocking the sibling `../api/userstories` module;
//   • the DndProvider component: the permission gate (inert pass-through when
//     disabled) and, when enabled, the full drag-handler lifecycle (activeId
//     tracking, NormalizedDragEnd shape, applyDrop wiring, promise-safe error
//     handling), asserted deterministically by stubbing `@dnd-kit/core` so the
//     captured handlers can be invoked without the sensor machinery.
//
// TEST-INDEPENDENCE: the neighbor / skip / mapping expectations below are pinned
// as INDEPENDENT literals derived from the authoritative CoffeeScript sources
// (kanban/backlog sortable.coffee + kanban/backlog main.coffee moveUs), never
// imported from the module under test, so any drift is caught by a failing
// assertion rather than silently agreeing with a wrong implementation.

import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import {
    applyDrop,
    computeNeighbors,
    createBacklogPersister,
    createKanbanPersister,
    DndProvider,
    isDragEnabled,
    mapSwimlaneForApi,
    shouldSkip,
} from "./DndProvider";
import type {
    BacklogPersistArgs,
    DndProject,
    DropLocation,
    DropNeighbors,
    KanbanPersistArgs,
    NormalizedDragEnd,
    ResolvedDrop,
} from "./DndProvider";
import { bulkUpdateBacklogOrder, bulkUpdateKanbanOrder } from "../api/userstories";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by ts-jest above the imports)
// ---------------------------------------------------------------------------

/** Handlers/props the stubbed DndContext captures so tests can drive them. */
interface CapturedDndProps {
    onDragStart?: (event: unknown) => void;
    onDragEnd?: (event: unknown) => void;
    onDragCancel?: () => void;
    sensors?: unknown;
    autoScroll?: boolean;
}

/** `mock`-prefixed so ts-jest's hoist guard allows the factory to reference it. */
const mockCaptured: CapturedDndProps = {};

// Stub @dnd-kit/core: replace DndContext/DragOverlay with plain <div>s that
// forward children and capture the handler props, and make the sensor hooks
// plain identity functions. This keeps the component test deterministic and
// lets us invoke the drag handlers directly (the real PointerSensor machinery
// cannot be driven reliably in jsdom).
jest.mock("@dnd-kit/core", () => {
    const react = require("react") as typeof import("react");

    return {
        __esModule: true,
        DndContext: (props: {
            children?: ReactNode;
            onDragStart?: (event: unknown) => void;
            onDragEnd?: (event: unknown) => void;
            onDragCancel?: () => void;
            sensors?: unknown;
            autoScroll?: boolean;
        }) => {
            mockCaptured.onDragStart = props.onDragStart;
            mockCaptured.onDragEnd = props.onDragEnd;
            mockCaptured.onDragCancel = props.onDragCancel;
            mockCaptured.sensors = props.sensors;
            mockCaptured.autoScroll = props.autoScroll;

            return react.createElement(
                "div",
                {
                    "data-testid": "dnd-context",
                    "data-autoscroll": String(props.autoScroll),
                },
                props.children,
            );
        },
        DragOverlay: (props: { children?: ReactNode }) =>
            react.createElement("div", { "data-testid": "drag-overlay" }, props.children),
        PointerSensor: { sensorName: "PointerSensor" },
        useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
        useSensors: (...descriptors: unknown[]) => descriptors,
    };
});

// Mock the sibling API so the persister factories can be asserted on argument
// order without hitting the real fetch stack.
jest.mock("../api/userstories", () => ({
    __esModule: true,
    bulkUpdateKanbanOrder: jest.fn(),
    bulkUpdateBacklogOrder: jest.fn(),
}));

const mockKanbanOrder = jest.mocked(bulkUpdateKanbanOrder);
const mockBacklogOrder = jest.mocked(bulkUpdateBacklogOrder);

/** A minimal successful HttpResponse-shaped value for the mocked API. */
const okResponse = { data: [], status: 200, headers: new Headers() };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("isDragEnabled", () => {
    it("returns false for null / undefined projects", () => {
        expect(isDragEnabled(null)).toBe(false);
        expect(isDragEnabled(undefined)).toBe(false);
    });

    it("returns false when my_permissions is undefined, null or an empty array", () => {
        expect(isDragEnabled({})).toBe(false);
        expect(isDragEnabled({ my_permissions: undefined })).toBe(false);
        expect(isDragEnabled({ my_permissions: null })).toBe(false);
        // Empty permission set => "modify_us" absent => disabled.
        expect(isDragEnabled({ my_permissions: [] })).toBe(false);
    });

    it("returns false without the modify_us permission", () => {
        expect(isDragEnabled({ my_permissions: ["view_us", "view_project"] })).toBe(false);
    });

    it("returns false when the project is archived (archived_code truthy)", () => {
        expect(
            isDragEnabled({ my_permissions: ["modify_us"], archived_code: "blocked" }),
        ).toBe(false);
    });

    it("returns true with modify_us and a falsy archived_code", () => {
        expect(isDragEnabled({ my_permissions: ["modify_us"] })).toBe(true);
        expect(
            isDragEnabled({ my_permissions: ["view_us", "modify_us"], archived_code: null }),
        ).toBe(true);
        expect(
            isDragEnabled({ my_permissions: ["modify_us"], archived_code: "" }),
        ).toBe(true);
    });
});

describe("computeNeighbors", () => {
    it("returns the immediate previous id (after) when dropped below the top", () => {
        // [10,20,30] dropping 20 into index 1 -> lands AFTER 10; next MUST be null.
        expect(computeNeighbors([10, 20, 30], 1, [20])).toEqual<DropNeighbors>({
            previous: 10,
            next: null,
        });
    });

    it("returns the immediate next id (before) ONLY when there is no previous", () => {
        // [20,10,30] dropping 20 into index 0 -> top of container -> lands BEFORE 10.
        expect(computeNeighbors([20, 10, 30], 0, [20])).toEqual<DropNeighbors>({
            previous: null,
            next: 10,
        });
    });

    it("forces next to null whenever a previous exists (the XOR contract)", () => {
        // 30 follows the drop, but because a previous (10) exists, next stays null.
        const result = computeNeighbors([10, 20, 30], 1, [20]);
        expect(result.previous).toBe(10);
        expect(result.next).toBeNull();
    });

    it("defaults draggedIds to the id at index for a single-item drag", () => {
        // No draggedIds passed -> defaults to [orderedIds[1]] = [20]; same as explicit.
        expect(computeNeighbors([10, 20, 30], 1)).toEqual<DropNeighbors>({
            previous: 10,
            next: null,
        });
    });

    it("skips every dragged id when scanning for neighbors (multi-drag ready)", () => {
        // Dragging {20,21} to the top: forward scan skips 21 (dragged) and picks 10.
        expect(computeNeighbors([20, 21, 10, 30], 0, [20, 21])).toEqual<DropNeighbors>({
            previous: null,
            next: 10,
        });
        // Dragging {20,21} into the middle: backward scan finds 10 as previous.
        expect(computeNeighbors([10, 20, 21, 30], 1, [20, 21])).toEqual<DropNeighbors>({
            previous: 10,
            next: null,
        });
    });

    it("returns {null,null} for an empty container", () => {
        expect(computeNeighbors([], 0)).toEqual<DropNeighbors>({ previous: null, next: null });
    });

    it("returns the previous id when dropped at the bottom of the container", () => {
        expect(computeNeighbors([10, 30, 20], 2, [20])).toEqual<DropNeighbors>({
            previous: 30,
            next: null,
        });
    });

    it("returns {null,null} for a single-element container dropped at the top", () => {
        // Spec literal: computeNeighbors([10], 0) -> nothing before, nothing after
        // (draggedIds defaults to [orderedIds[0]] = [10], so the lone id is excluded).
        expect(computeNeighbors([10], 0)).toEqual<DropNeighbors>({
            previous: null,
            next: null,
        });
    });

    it("skips a dragged id when scanning BACKWARD for previous (multi-drag)", () => {
        // Spec literal: [10,20,30,40] dropped at index 2 dragging {30,20}; the
        // backward scan from index 1 skips 20 (dragged) and lands on 10; because a
        // previous exists the XOR gate keeps next null.
        expect(computeNeighbors([10, 20, 30, 40], 2, [30, 20])).toEqual<DropNeighbors>({
            previous: 10,
            next: null,
        });
    });

    it("finds next at the top while skipping a dragged immediate neighbor (XOR at top)", () => {
        // Spec literal: [20,30,10] dropped at index 0 dragging {20}; nothing precedes
        // index 0 (previous null) so the forward scan runs and picks 30 (index 1, not
        // dragged) — never the dragged 20.
        expect(computeNeighbors([20, 30, 10], 0, [20])).toEqual<DropNeighbors>({
            previous: null,
            next: 30,
        });
    });
});

describe("shouldSkip", () => {
    const at = (containerKey: string, index: number): DropLocation => ({ containerKey, index });

    it("returns true only for the same container AND the same index", () => {
        expect(shouldSkip(at("col:1", 2), at("col:1", 2))).toBe(true);
    });

    it("returns false when the index changed in the same container", () => {
        expect(shouldSkip(at("col:1", 2), at("col:1", 3))).toBe(false);
    });

    it("returns false when the container changed at the same index", () => {
        expect(shouldSkip(at("col:1", 2), at("col:2", 2))).toBe(false);
    });
});

describe("mapSwimlaneForApi", () => {
    it("maps the sentinel -1 to null", () => {
        expect(mapSwimlaneForApi(-1)).toBeNull();
    });

    it("passes every other value through unchanged (including 0)", () => {
        expect(mapSwimlaneForApi(0)).toBe(0);
        expect(mapSwimlaneForApi(5)).toBe(5);
        expect(mapSwimlaneForApi(42)).toBe(42);
    });
});

describe("applyDrop", () => {
    const resolved: ResolvedDrop = {
        origin: { containerKey: "col:1", index: 0 },
        target: { containerKey: "col:2", index: 1 },
        orderedIds: [10, 20, 30],
        draggedIds: [20],
    };

    it("does nothing (no persist) when the resolved drop is null", () => {
        const persist = jest.fn();
        expect(applyDrop(null, persist)).toBeUndefined();
        expect(persist).not.toHaveBeenCalled();
    });

    it("skips persistence for a no-op move (same container + same index)", () => {
        const persist = jest.fn();
        const noop: ResolvedDrop = {
            origin: { containerKey: "col:1", index: 3 },
            target: { containerKey: "col:1", index: 3 },
            orderedIds: [1, 2, 3],
            draggedIds: [2],
        };
        expect(applyDrop(noop, persist)).toBeUndefined();
        expect(persist).not.toHaveBeenCalled();
    });

    it("computes neighbors and calls persist for a real move", () => {
        const persist = jest.fn();
        applyDrop(resolved, persist);
        expect(persist).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledWith(resolved, { previous: 10, next: null });
    });

    it("returns the persister's promise so callers can await it", async () => {
        const persist = jest.fn().mockResolvedValue(undefined);
        const result = applyDrop(resolved, persist);
        expect(result).toBeInstanceOf(Promise);
        await expect(result).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Persister factories
// ---------------------------------------------------------------------------

describe("createKanbanPersister", () => {
    beforeEach(() => {
        mockKanbanOrder.mockResolvedValue(okResponse);
    });

    it("maps swimlane -1 -> null and calls bulkUpdateKanbanOrder in the exact arg order", async () => {
        const persist = createKanbanPersister(7);
        const args: KanbanPersistArgs = {
            statusId: 3,
            swimlaneId: -1,
            afterUserstoryId: 100,
            beforeUserstoryId: null,
            bulkUserstories: [55],
        };

        await persist(args);

        // (projectId, statusId, swimlane(mapped), after, before, bulk)
        expect(mockKanbanOrder).toHaveBeenCalledTimes(1);
        expect(mockKanbanOrder).toHaveBeenCalledWith(7, 3, null, 100, null, [55]);
    });

    it("passes a real swimlane id straight through", async () => {
        const persist = createKanbanPersister(7);
        const args: KanbanPersistArgs = {
            statusId: 2,
            swimlaneId: 9,
            afterUserstoryId: null,
            beforeUserstoryId: 200,
            bulkUserstories: [56, 57],
        };

        await persist(args);

        expect(mockKanbanOrder).toHaveBeenCalledWith(7, 2, 9, null, 200, [56, 57]);
    });
});

describe("createBacklogPersister", () => {
    beforeEach(() => {
        mockBacklogOrder.mockResolvedValue(okResponse);
    });

    it("calls bulkUpdateBacklogOrder in the exact arg order with a milestone id", async () => {
        const persist = createBacklogPersister(11);
        const args: BacklogPersistArgs = {
            milestoneId: 42,
            afterUserstoryId: 300,
            beforeUserstoryId: null,
            bulkUserstories: [70],
        };

        await persist(args);

        // (projectId, milestoneId, after, before, bulk)
        expect(mockBacklogOrder).toHaveBeenCalledTimes(1);
        expect(mockBacklogOrder).toHaveBeenCalledWith(11, 42, 300, null, [70]);
    });

    it("passes milestoneId null (backlog) through unchanged", async () => {
        const persist = createBacklogPersister(11);
        const args: BacklogPersistArgs = {
            milestoneId: null,
            afterUserstoryId: null,
            beforeUserstoryId: 301,
            bulkUserstories: [71],
        };

        await persist(args);

        expect(mockBacklogOrder).toHaveBeenCalledWith(11, null, null, 301, [71]);
    });
});

// ---------------------------------------------------------------------------
// DndProvider component
// ---------------------------------------------------------------------------

const enabledProject: DndProject = { my_permissions: ["modify_us"], archived_code: null };
const disabledProject: DndProject = { my_permissions: [], archived_code: null };

/** A trivial resolver that echoes a fixed resolved drop, for handler tests. */
function makeResolved(): ResolvedDrop {
    return {
        origin: { containerKey: "col:1", index: 0 },
        target: { containerKey: "col:2", index: 1 },
        orderedIds: [10, 20, 30],
        draggedIds: [20],
    };
}

describe("DndProvider — permission gate", () => {
    it("renders children WITHOUT a DndContext when DnD is disabled", () => {
        render(
            <DndProvider
                project={disabledProject}
                resolveDrop={() => null}
                persist={() => undefined}
            >
                <div data-testid="board">board</div>
            </DndProvider>,
        );

        expect(screen.getByTestId("board")).toBeInTheDocument();
        expect(screen.queryByTestId("dnd-context")).not.toBeInTheDocument();
        expect(screen.queryByTestId("drag-overlay")).not.toBeInTheDocument();
    });

    it("wraps children in a DndContext when DnD is enabled", () => {
        render(
            <DndProvider
                project={enabledProject}
                resolveDrop={() => null}
                persist={() => undefined}
            >
                <div data-testid="board">board</div>
            </DndProvider>,
        );

        expect(screen.getByTestId("dnd-context")).toBeInTheDocument();
        expect(screen.getByTestId("board")).toBeInTheDocument();
        expect(screen.getByTestId("drag-overlay")).toBeInTheDocument();
    });
});

describe("DndProvider — configuration", () => {
    it("enables built-in autoScroll by default and honors an explicit false", () => {
        const { rerender } = render(
            <DndProvider project={enabledProject} resolveDrop={() => null} persist={() => undefined}>
                <div>board</div>
            </DndProvider>,
        );
        expect(screen.getByTestId("dnd-context")).toHaveAttribute("data-autoscroll", "true");

        rerender(
            <DndProvider
                project={enabledProject}
                resolveDrop={() => null}
                persist={() => undefined}
                autoScroll={false}
            >
                <div>board</div>
            </DndProvider>,
        );
        expect(screen.getByTestId("dnd-context")).toHaveAttribute("data-autoscroll", "false");
    });

    it("configures the PointerSensor with the default 5px activation distance", () => {
        render(
            <DndProvider project={enabledProject} resolveDrop={() => null} persist={() => undefined}>
                <div>board</div>
            </DndProvider>,
        );

        const sensors = mockCaptured.sensors as Array<{
            sensor: { sensorName: string };
            options: { activationConstraint: { distance: number } };
        }>;
        expect(sensors).toHaveLength(1);
        expect(sensors[0].sensor.sensorName).toBe("PointerSensor");
        expect(sensors[0].options.activationConstraint.distance).toBe(5);
    });

    it("honors a custom activationDistance", () => {
        render(
            <DndProvider
                project={enabledProject}
                resolveDrop={() => null}
                persist={() => undefined}
                activationDistance={12}
            >
                <div>board</div>
            </DndProvider>,
        );

        const sensors = mockCaptured.sensors as Array<{
            options: { activationConstraint: { distance: number } };
        }>;
        expect(sensors[0].options.activationConstraint.distance).toBe(12);
    });
});

describe("DndProvider — drag lifecycle", () => {
    it("tracks the active id through the overlay renderer on start / cancel", () => {
        const renderDragOverlay = (activeId: number | null): ReactNode => (
            <span data-testid="overlay-content">overlay:{String(activeId)}</span>
        );

        render(
            <DndProvider
                project={enabledProject}
                resolveDrop={() => null}
                persist={() => undefined}
                renderDragOverlay={renderDragOverlay}
            >
                <div>board</div>
            </DndProvider>,
        );

        // Initial render: overlay renderer called with null.
        expect(screen.getByTestId("overlay-content")).toHaveTextContent("overlay:null");

        // Drag start sets the numeric active id.
        act(() => {
            mockCaptured.onDragStart?.({ active: { id: "7" } });
        });
        expect(screen.getByTestId("overlay-content")).toHaveTextContent("overlay:7");

        // Drag cancel clears it.
        act(() => {
            mockCaptured.onDragCancel?.();
        });
        expect(screen.getByTestId("overlay-content")).toHaveTextContent("overlay:null");
    });

    it("builds a NormalizedDragEnd and calls persist with provider-computed neighbors", () => {
        const resolved = makeResolved();
        const seen: NormalizedDragEnd[] = [];
        const resolveDrop = (event: NormalizedDragEnd): ResolvedDrop => {
            seen.push(event);
            return resolved;
        };
        const persist = jest.fn();

        render(
            <DndProvider project={enabledProject} resolveDrop={resolveDrop} persist={persist}>
                <div>board</div>
            </DndProvider>,
        );

        act(() => {
            mockCaptured.onDragEnd?.({ active: { id: "20" }, over: { id: "col:2" } });
        });

        // NormalizedDragEnd: activeId = Number(active.id); overId = over.id.
        expect(seen).toHaveLength(1);
        expect(seen[0].activeId).toBe(20);
        expect(seen[0].overId).toBe("col:2");

        // persist called with (resolved, neighbors) where neighbors come from
        // computeNeighbors([10,20,30], 1, [20]) = { previous: 10, next: null }.
        expect(persist).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledWith(resolved, { previous: 10, next: null });
    });

    it("normalizes a null drop target (overId null) and skips persist when resolveDrop returns null", () => {
        const seen: NormalizedDragEnd[] = [];
        const resolveDrop = (event: NormalizedDragEnd): ResolvedDrop | null => {
            seen.push(event);
            return null;
        };
        const persist = jest.fn();

        render(
            <DndProvider project={enabledProject} resolveDrop={resolveDrop} persist={persist}>
                <div>board</div>
            </DndProvider>,
        );

        act(() => {
            mockCaptured.onDragEnd?.({ active: { id: "5" }, over: null });
        });

        expect(seen[0].overId).toBeNull();
        expect(persist).not.toHaveBeenCalled();
    });

    it("logs (never throws) when an async persist rejects", async () => {
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const persist = jest.fn().mockRejectedValue(new Error("network down"));

        render(
            <DndProvider
                project={enabledProject}
                resolveDrop={() => makeResolved()}
                persist={persist}
            >
                <div>board</div>
            </DndProvider>,
        );

        await act(async () => {
            mockCaptured.onDragEnd?.({ active: { id: "20" }, over: { id: "col:2" } });
            // Flush the microtask queue so the .catch handler runs.
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(persist).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith(
            "[taiga-react] drag-and-drop order persistence failed",
            expect.any(Error),
        );

        errorSpy.mockRestore();
    });
});
