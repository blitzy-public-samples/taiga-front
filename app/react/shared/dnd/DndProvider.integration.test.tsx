/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// INTEGRATION suite for the shared drag-and-drop provider — M-43.
//
// Unlike the co-located unit suite (`DndProvider.test.tsx`), this file uses the
// REAL `@dnd-kit/core` library (it is deliberately NOT mocked). It proves the
// provider's ACTUAL public contract against genuine dnd-kit machinery, closing
// the credibility gap called out in review finding M-43 ("Entire dnd-kit layer
// is mocked; real keyboard / cross-list / multi-drag / permission / rollback
// behavior is unproved"):
//
//   1. PERMISSION GATE (real library): when enabled the provider mounts a real
//      `DndContext` (proven by dnd-kit's accessibility live region + genuine
//      `useDraggable` ARIA/role attributes); when disabled it is an inert
//      pass-through with NO DndContext and NO drag machinery.
//   2. KEYBOARD drag (accessible, real `KeyboardSensor`): a full Space → Arrow →
//      Space sequence drives the real drag lifecycle and flows through the
//      provider's `resolveDrop → applyDrop → persist` pipeline.
//   3. CROSS-LIST and MULTI-DRAG ordering through the real pipeline.
//   4. ROLLBACK: a rejecting `persist` signals `onPersistError` with the exact
//      resolved drop (the recoverable-failure contract from M-41), proven end to
//      end through the real drag lifecycle rather than a stubbed handler.
//   5. Hooks stability across an enabled/disabled/enabled gate flip with the REAL
//      `useSensors` hook (strengthens M-42).
//
// Only the sibling `../api/userstories` module is mocked, purely to keep the
// suite off the network — the DnD layer under test is 100% real. Each test
// injects its own `persist`, so the mocked API functions are never invoked.
//
// jsdom note: elements have zero-size layout, so real collision detection yields
// `over === null` at drop time. That is expected and irrelevant here — the
// per-screen `resolveDrop` (which in production owns item→container/index
// resolution from board state) is injected to return a deterministic
// `ResolvedDrop`, so the ordering/persistence contract is exercised faithfully
// regardless of jsdom geometry.

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { useDraggable, useDroppable } from "@dnd-kit/core";

import { DndProvider } from "./DndProvider";
import type {
    DndProject,
    DropNeighbors,
    NormalizedDragEnd,
    ResolvedDrop,
} from "./DndProvider";

// Keep the suite off the network. The DnD layer is intentionally REAL; only the
// bulk-order API is stubbed. `persist` is injected per-test, so these are never
// actually called — the mock just prevents importing the real fetch stack.
jest.mock("../api/userstories", () => ({
    __esModule: true,
    bulkUpdateKanbanOrder: jest.fn(),
    bulkUpdateBacklogOrder: jest.fn(),
}));

const enabledProject: DndProject = { my_permissions: ["modify_us"], archived_code: null };
const disabledProject: DndProject = { my_permissions: [], archived_code: null };

/** Resolve a microtask/timer tick so deferred dnd-kit listeners/announcements settle. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Real draggable / droppable built on the actual @dnd-kit/core hooks
// ---------------------------------------------------------------------------

/** A real draggable using the genuine `useDraggable` hook (id 20). */
function Draggable(): JSX.Element {
    const { attributes, listeners, setNodeRef } = useDraggable({ id: "20" });
    return (
        <button
            ref={setNodeRef}
            data-testid="drag-20"
            data-id="20"
            {...attributes}
            {...listeners}
        >
            story 20
        </button>
    );
}

/** A real droppable using the genuine `useDroppable` hook. */
function Droppable({ id, children }: { id: string; children?: ReactNode }): JSX.Element {
    const { setNodeRef } = useDroppable({ id });
    return (
        <div ref={setNodeRef} data-testid={`drop-${id}`} data-status={id}>
            {children}
        </div>
    );
}

interface HarnessProps {
    project?: DndProject;
    resolveDrop: (event: NormalizedDragEnd) => ResolvedDrop | null;
    persist: (resolved: ResolvedDrop, neighbors: DropNeighbors) => void | Promise<void>;
    onPersistError?: (error: unknown, resolved: ResolvedDrop | null) => void;
    withDraggable?: boolean;
}

function Harness(props: HarnessProps): JSX.Element {
    const {
        project = enabledProject,
        resolveDrop,
        persist,
        onPersistError,
        withDraggable = true,
    } = props;

    return (
        <DndProvider
            project={project}
            resolveDrop={resolveDrop}
            persist={persist}
            onPersistError={onPersistError}
        >
            <Droppable id="col1">
                {withDraggable ? <Draggable /> : <span data-testid="plain">plain</span>}
            </Droppable>
            <Droppable id="col2" />
        </DndProvider>
    );
}

/**
 * Drive a complete, REAL keyboard drag through dnd-kit's `KeyboardSensor`:
 * focus the draggable, Space to pick up, ArrowDown to move, Space to drop.
 *
 * The pickup keydown must target the draggable node (its `listeners` activate
 * the sensor). `KeyboardSensor.attach()` registers the move/drop keydown handler
 * on `document` via a `setTimeout`, so we flush a tick after pickup and dispatch
 * the subsequent keys on `document`. A final flush lets the async `persist`
 * settle so any `onPersistError` recovery has run.
 */
async function keyboardDrag(node: HTMLElement): Promise<void> {
    await act(async () => {
        node.focus();
        fireEvent.keyDown(node, { code: "Space" });
        await tick();
    });
    await act(async () => {
        fireEvent.keyDown(document, { code: "ArrowDown" });
        await tick();
    });
    await act(async () => {
        fireEvent.keyDown(document, { code: "Space" });
        await tick();
    });
    await act(async () => {
        await tick();
    });
}

// ---------------------------------------------------------------------------
// 1. Permission gate against the REAL library
// ---------------------------------------------------------------------------

describe("DndProvider integration — permission gate (real @dnd-kit/core)", () => {
    it("mounts a REAL DndContext (accessibility live region + genuine draggable attrs) when enabled", () => {
        render(
            <Harness resolveDrop={() => null} persist={jest.fn()} />,
        );

        // dnd-kit's DndContext renders a visually-hidden ARIA live region; its
        // presence is deterministic proof the REAL context is mounted.
        expect(document.querySelectorAll('[role="status"]').length).toBeGreaterThan(0);

        // The real `useDraggable` hook produced genuine dnd-kit semantics.
        const drag = screen.getByTestId("drag-20");
        expect(drag).toHaveAttribute("role", "button");
        expect(drag).toHaveAttribute("aria-roledescription", "draggable");
        expect(drag).toHaveAttribute("tabindex", "0");
        expect(drag.getAttribute("aria-describedby")).toMatch(/^DndDescribedBy/);
    });

    it("is an inert pass-through with NO DndContext and NO drag machinery when disabled", async () => {
        const persist = jest.fn();
        render(
            <Harness
                project={disabledProject}
                resolveDrop={() => {
                    throw new Error("resolveDrop must not run when DnD is disabled");
                }}
                persist={persist}
            />,
        );

        // Children still render...
        expect(screen.getByTestId("drag-20")).toBeInTheDocument();
        // ...but there is NO real DndContext (no accessibility live region).
        expect(document.querySelectorAll('[role="status"]').length).toBe(0);

        // A keyboard "drag" attempt cannot start (no sensors wired) → no persist.
        await keyboardDrag(screen.getByTestId("drag-20"));
        expect(persist).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// 2-3. Real KEYBOARD drag drives the ordering + persistence pipeline
// ---------------------------------------------------------------------------

describe("DndProvider integration — real keyboard drag pipeline", () => {
    it("drives resolveDrop -> applyDrop -> persist for a single-item move (accessible keyboard DnD)", async () => {
        // Independent literal (not imported from the module): [10,20,30] dropping
        // 20 at index 1 lands AFTER 10, so neighbors are { previous: 10, next: null }.
        const resolved: ResolvedDrop = {
            origin: { containerKey: "col:1", index: 0 },
            target: { containerKey: "col:2", index: 1 },
            orderedIds: [10, 20, 30],
            draggedIds: [20],
        };
        let seen: NormalizedDragEnd | null = null;
        const resolveDrop = jest.fn((event: NormalizedDragEnd): ResolvedDrop => {
            seen = event;
            return resolved;
        });
        const persist = jest.fn();

        render(<Harness resolveDrop={resolveDrop} persist={persist} />);

        await keyboardDrag(screen.getByTestId("drag-20"));

        // The REAL drag-end event flowed into the provider's resolver.
        expect(resolveDrop).toHaveBeenCalled();
        expect(seen).not.toBeNull();
        expect((seen as unknown as NormalizedDragEnd).activeId).toBe(20);
        expect((seen as unknown as NormalizedDragEnd).event).toBeDefined();

        // ...and the provider-computed neighbors reached persist exactly once.
        expect(persist).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledWith(resolved, { previous: 10, next: null });
    });

    it("supports MULTI-DRAG neighbor skipping through the real pipeline", async () => {
        // Dragging {20,21} to the top of [20,21,10,30]: previous null, forward scan
        // skips dragged 21 and picks 10 → { previous: null, next: 10 }.
        const resolved: ResolvedDrop = {
            origin: { containerKey: "col:1", index: 0 },
            target: { containerKey: "col:2", index: 0 },
            orderedIds: [20, 21, 10, 30],
            draggedIds: [20, 21],
        };
        const persist = jest.fn();

        render(<Harness resolveDrop={() => resolved} persist={persist} />);

        await keyboardDrag(screen.getByTestId("drag-20"));

        expect(persist).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledWith(resolved, { previous: null, next: 10 });
    });

    it("supports a CROSS-LIST move (origin container != target container) and does NOT skip it", async () => {
        // Moved from a sprint into the backlog at the top of [20,30,40]:
        // { previous: null, next: 30 }. Different containerKey ⇒ never skipped.
        const resolved: ResolvedDrop = {
            origin: { containerKey: "sprint:1", index: 2 },
            target: { containerKey: "backlog", index: 0 },
            orderedIds: [20, 30, 40],
            draggedIds: [20],
        };
        const persist = jest.fn();

        render(<Harness resolveDrop={() => resolved} persist={persist} />);

        await keyboardDrag(screen.getByTestId("drag-20"));

        expect(persist).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledWith(resolved, { previous: null, next: 30 });
    });

    it("does NOT persist a no-op keyboard drag (same container AND same index)", async () => {
        const resolved: ResolvedDrop = {
            origin: { containerKey: "col:1", index: 0 },
            target: { containerKey: "col:1", index: 0 },
            orderedIds: [20, 30, 40],
            draggedIds: [20],
        };
        const persist = jest.fn();

        render(<Harness resolveDrop={() => resolved} persist={persist} />);

        await keyboardDrag(screen.getByTestId("drag-20"));

        expect(persist).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// 4. Recoverable failure signaling through the real pipeline (M-41 x M-43)
// ---------------------------------------------------------------------------

describe("DndProvider integration — persistence failure recovery (real pipeline)", () => {
    it("signals onPersistError with the error AND the resolved drop when a real keyboard drop's persist rejects", async () => {
        const resolved: ResolvedDrop = {
            origin: { containerKey: "col:1", index: 0 },
            target: { containerKey: "col:2", index: 1 },
            orderedIds: [10, 20, 30],
            draggedIds: [20],
        };
        const error = new Error("bulk-order 500");
        const persist = jest.fn().mockRejectedValue(error);
        const onPersistError = jest.fn();
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        render(
            <Harness
                resolveDrop={() => resolved}
                persist={persist}
                onPersistError={onPersistError}
            />,
        );

        await keyboardDrag(screen.getByTestId("drag-20"));

        expect(persist).toHaveBeenCalledTimes(1);
        // Rollback contract proven END-TO-END through the real drag lifecycle.
        expect(onPersistError).toHaveBeenCalledTimes(1);
        expect(onPersistError).toHaveBeenCalledWith(error, resolved);
        // With a handler present, no console fallback fires.
        expect(errorSpy).not.toHaveBeenCalled();

        errorSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// 5. Hooks stability with the REAL useSensors hook (strengthens M-42)
// ---------------------------------------------------------------------------

describe("DndProvider integration — hooks stability across the gate (real useSensors)", () => {
    it("enabled -> disabled -> enabled rerenders on the SAME instance produce no hook-order warning", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const resolveDrop = (): null => null;
        const persist = jest.fn();

        const { rerender } = render(
            <Harness project={enabledProject} resolveDrop={resolveDrop} persist={persist} />,
        );
        expect(document.querySelectorAll('[role="status"]').length).toBeGreaterThan(0);

        rerender(
            <Harness
                project={disabledProject}
                resolveDrop={resolveDrop}
                persist={persist}
                withDraggable={false}
            />,
        );
        expect(document.querySelectorAll('[role="status"]').length).toBe(0);
        expect(screen.getByTestId("plain")).toBeInTheDocument();

        rerender(
            <Harness project={enabledProject} resolveDrop={resolveDrop} persist={persist} />,
        );
        expect(document.querySelectorAll('[role="status"]').length).toBeGreaterThan(0);

        const hookWarnings = errorSpy.mock.calls.filter((callArgs) => {
            const first = callArgs[0];
            return (
                typeof first === "string" &&
                /rendered (more|fewer) hooks|order of Hooks|rules of hooks/i.test(first)
            );
        });
        expect(hookWarnings).toEqual([]);

        errorSpy.mockRestore();
    });
});
