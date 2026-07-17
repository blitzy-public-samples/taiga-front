/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */
import { render } from "@testing-library/react";
import { KanbanBoard } from "../KanbanBoard";
import {
    createInitialState,
    reduceInit,
    reduceSetUserstories,
} from "../useKanbanState";
import type {
    KanbanProject,
    KanbanState,
    Status,
    Swimlane,
    UserStoryModel,
} from "../useKanbanState";

const statuses: Status[] = [
    { id: 1, name: "New", color: "#f00", order: 1, is_archived: false, wip_limit: null },
    { id: 2, name: "Done", color: "#0f0", order: 2, is_archived: false, wip_limit: null },
];
const project: KanbanProject = {
    id: 7, my_permissions: ["modify_us"], us_statuses: statuses, i_am_admin: true,
};
function usm(over: Partial<UserStoryModel> & { id: number }): UserStoryModel {
    return { status: 1, swimlane: null, kanban_order: over.id, ...over } as UserStoryModel;
}
function baseProps(state: KanbanState) {
    return {
        state, project, zoom: ["ref", "subject"], zoomLevel: 2,
        folds: {}, unfold: null, foldedSwimlane: {}, canAddUs: true,
        resolveDrop: jest.fn().mockReturnValue(null),
        persist: jest.fn(),
    };
}

describe("KanbanBoard no-swimlane mode", () => {
    it("renders zoom-{level}, one header cell per status and a single body", () => {
        let s = reduceInit(createInitialState(), project, [], {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1 }), usm({ id: 102, status: 2 })]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);
        expect(container.querySelector(".kanban-table.zoom-2")).not.toBeNull();
        expect(container.querySelector(".kanban-table-swimlane")).toBeNull();
        expect(container.querySelectorAll(".kanban-table-header .task-colum-name").length).toBe(2);
        expect(container.querySelectorAll(".kanban-table-body").length).toBe(1);
        const cols = container.querySelectorAll(".kanban-uses-box.taskboard-column");
        expect(cols.length).toBe(2);
        expect(cols[0].hasAttribute("data-swimlane")).toBe(false);
    });
});

describe("KanbanBoard swimlane mode", () => {
    it("adds the kanban-table-swimlane class and renders per-swimlane bodies", () => {
        const swimlanes: Swimlane[] = [{ id: 50, name: "SW", statuses }];
        let s = reduceInit(createInitialState(), project, swimlanes, {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1, swimlane: 50 })]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);
        expect(container.querySelector(".kanban-table.kanban-table-swimlane")).not.toBeNull();
        expect(container.querySelectorAll(".kanban-swimlane").length).toBeGreaterThanOrEqual(1);
        const cols = container.querySelectorAll(".kanban-swimlane .kanban-uses-box");
        expect(cols.length).toBeGreaterThanOrEqual(1);
        expect(cols[0]).toHaveAttribute("data-swimlane", "50");
    });

    it("[C-06] gives every column a unique status+swimlane DOM id across swimlanes", () => {
        // The SAME status renders once per swimlane; a status-only id would
        // collide once per swimlane (invalid HTML). Ids must fold in swimlane
        // identity so each cell is addressable.
        const swimlanes: Swimlane[] = [
            { id: 50, name: "SW-A", statuses },
            { id: 60, name: "SW-B", statuses },
        ];
        let s = reduceInit(createInitialState(), project, swimlanes, {});
        s = reduceSetUserstories(s, [
            usm({ id: 101, status: 1, swimlane: 50 }),
            usm({ id: 102, status: 1, swimlane: 60 }),
        ]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);
        const ids = Array.from(
            container.querySelectorAll(".kanban-uses-box.taskboard-column"),
        ).map((el) => el.id);
        // Two swimlanes x two statuses = four columns, all uniquely identified.
        expect(ids.length).toBe(4);
        expect(new Set(ids).size).toBe(ids.length);
        // Status 1 in each swimlane resolves to a distinct, sentinel-suffixed id.
        expect(ids).toContain("column-1-50");
        expect(ids).toContain("column-1-60");
    });

    it("[C-06] suffixes the no-swimlane column id with the -1 sentinel", () => {
        let s = reduceInit(createInitialState(), project, [], {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1 })]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);
        const first = container.querySelector(
            ".kanban-uses-box.taskboard-column",
        ) as HTMLElement;
        expect(first.id).toBe("column-1--1");
    });

    it("shows the swimlane-add affordance when admin and only one swimlane", () => {
        const swimlanes: Swimlane[] = [{ id: 50, name: "SW", statuses }];
        let s = reduceInit(createInitialState(), project, swimlanes, {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1, swimlane: 50 })]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);
        expect(container.querySelector(".kanban-swimlane-add")).not.toBeNull();
    });

    it("hides the swimlane-add affordance on an archived project (QA-FUNC-11)", () => {
        // Even for an admin with a single swimlane, "Create swimlane" is an
        // editing affordance and must be disabled on an archived project
        // (canEdit === false when archived).
        const swimlanes: Swimlane[] = [{ id: 50, name: "SW", statuses }];
        const archivedProject: KanbanProject = {
            ...project,
            archived_code: "blocked-by-owner-leaving",
        };
        let s = reduceInit(createInitialState(), archivedProject, swimlanes, {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1, swimlane: 50 })]);
        const { container } = render(
            <KanbanBoard {...baseProps(s)} project={archivedProject} />,
        );
        expect(container.querySelector(".kanban-swimlane-add")).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// [M-14] Responsive board sizing + scroll synchronization.
// Ports the four imperative DOM behaviors the legacy AngularJS board attached
// to the `.kanban-table` root and its columns:
//   1. `--kanban-width` published on <body> from a ResizeObserver over the
//      header `.task-colum-name` cells (KanbanDirective.watchKanbanSize).
//   2. No-swimlane header/body horizontal scroll sync (kanbanTableLoaded).
//   3. Swimlane sticky-title / add horizontal translation (KanbanSwimlaneDirective).
// (Behavior 4, the sticky task-counter, is covered in KanbanColumn.test.tsx.)
// ---------------------------------------------------------------------------

// A controllable ResizeObserver stub: jsdom ships none, and @dnd-kit's
// `useDroppable` also instantiates one when the global is present. The stub
// records observe/unobserve/disconnect and lets the test fire the callback for
// the specific instance that watches the header column cells.
interface StubRO {
    cb: () => void;
    observed: Set<Element>;
    disconnected: boolean;
    unobserve(el: Element): void;
}
let roInstances: StubRO[];

describe("KanbanBoard [M-14] responsive / scroll synchronization", () => {
    const originalRO = (globalThis as { ResizeObserver?: unknown })
        .ResizeObserver;

    beforeEach(() => {
        roInstances = [];
        class ResizeObserverStub implements StubRO {
            cb: () => void;
            observed = new Set<Element>();
            disconnected = false;
            constructor(cb: () => void) {
                this.cb = cb;
                roInstances.push(this);
            }
            observe(el: Element): void {
                this.observed.add(el);
            }
            unobserve(el: Element): void {
                this.observed.delete(el);
            }
            disconnect(): void {
                this.disconnected = true;
                this.observed.clear();
            }
        }
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
            ResizeObserverStub as unknown as typeof globalThis.ResizeObserver;

        // Inject the legacy inter-column margin shorthand into the root's
        // computed `--kanban-column-margin` (jsdom computes "" otherwise), while
        // delegating every other property to the real computed style so
        // @dnd-kit and layout reads are unaffected.
        const realGetComputedStyle = window.getComputedStyle.bind(window);
        jest
            .spyOn(window, "getComputedStyle")
            .mockImplementation((...args: unknown[]): CSSStyleDeclaration => {
                const el = args[0] as Element;
                const pseudo = args[1] as string | null | undefined;
                const style = realGetComputedStyle(el, pseudo ?? undefined);
                const origGet = style.getPropertyValue.bind(style);
                style.getPropertyValue = (prop: string): string =>
                    prop === "--kanban-column-margin"
                        ? "0 5px 0 0"
                        : origGet(prop);
                return style;
            });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
        document.body.style.removeProperty("--kanban-width");
    });

    function findHeaderObserver(): StubRO {
        const found = roInstances.find((ro) =>
            Array.from(ro.observed).some((el) =>
                (el as HTMLElement).classList.contains("task-colum-name"),
            ),
        );
        if (!found) {
            throw new Error("no ResizeObserver watching header columns");
        }
        return found;
    }

    it("Behavior 1: publishes --kanban-width summing column widths + margin", () => {
        let s = reduceInit(createInitialState(), project, [], {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1 })]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);

        const cols = container.querySelectorAll<HTMLElement>(
            ".kanban-table-header .task-colum-name",
        );
        expect(cols.length).toBe(2);
        Object.defineProperty(cols[0], "offsetWidth", {
            configurable: true,
            value: 200,
        });
        Object.defineProperty(cols[1], "offsetWidth", {
            configurable: true,
            value: 300,
        });

        // Fire the observer: width = (200+5) + (300+5) = 510; published value
        // subtracts one trailing margin → 505px (matches legacy `width - margin`).
        findHeaderObserver().cb();
        expect(document.body.style.getPropertyValue("--kanban-width")).toBe(
            "505px",
        );
    });

    it("Behavior 1: skips detached columns and clears the var on unmount", () => {
        let s = reduceInit(createInitialState(), project, [], {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1 })]);
        const { container, unmount } = render(<KanbanBoard {...baseProps(s)} />);

        const cols = container.querySelectorAll<HTMLElement>(
            ".kanban-table-header .task-colum-name",
        );
        Object.defineProperty(cols[0], "offsetWidth", {
            configurable: true,
            value: 100,
        });
        Object.defineProperty(cols[1], "offsetWidth", {
            configurable: true,
            value: 100,
        });
        const observer = findHeaderObserver();
        // Detach the second column: it must be unobserved and excluded from the
        // width sum → (100+5) only, minus one margin → 100px.
        cols[1].remove();
        observer.cb();
        expect(document.body.style.getPropertyValue("--kanban-width")).toBe(
            "100px",
        );
        expect(observer.observed.has(cols[1])).toBe(false);

        // Unmount disconnects the observer and clears the published var so no
        // stale board width leaks into the next screen.
        unmount();
        expect(observer.disconnected).toBe(true);
        expect(document.body.style.getPropertyValue("--kanban-width")).toBe("");
    });

    it("Behavior 2: no-swimlane body scroll translates the sticky header inner", () => {
        let s = reduceInit(createInitialState(), project, [], {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1 })]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);

        const body = container.querySelector(
            ".kanban-table-body",
        ) as HTMLElement;
        const headerInner = container.querySelector(
            ".kanban-table-header .kanban-table-inner",
        ) as HTMLElement;
        Object.defineProperty(body, "scrollLeft", {
            configurable: true,
            value: 37,
        });
        body.dispatchEvent(new Event("scroll"));
        // Header is translated by the NEGATED scrollLeft (legacy `-1 * scrollLeft`).
        expect(headerInner.style.transform).toBe("translateX(-37px)");
    });

    it("Behavior 3: swimlane-mode root scroll translates titles and the add affordance", () => {
        const swimlanes: Swimlane[] = [{ id: 50, name: "SW", statuses }];
        let s = reduceInit(createInitialState(), project, swimlanes, {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1, swimlane: 50 })]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);

        const root = container.querySelector(
            ".kanban-table-swimlane",
        ) as HTMLElement;
        Object.defineProperty(root, "scrollLeft", {
            configurable: true,
            value: 22,
        });
        root.dispatchEvent(new Event("scroll"));

        const title = container.querySelector(
            ".kanban-swimlane-title",
        ) as HTMLElement;
        expect(title.style.transform).toBe("translateX(22px)");
        // Admin + single swimlane also renders the "add swimlane" affordance,
        // which is pinned the SAME way (positive scrollLeft).
        const add = container.querySelector(
            ".kanban-swimlane-add",
        ) as HTMLElement;
        expect(add.style.transform).toBe("translateX(22px)");
    });

    it("Behavior 2 is inert in swimlane mode (root, not body, is the scrollport)", () => {
        const swimlanes: Swimlane[] = [{ id: 50, name: "SW", statuses }];
        let s = reduceInit(createInitialState(), project, swimlanes, {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1, swimlane: 50 })]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);

        // The per-swimlane `.kanban-table-body` does NOT drive the header in
        // swimlane mode; scrolling it must leave the header inner untouched.
        const body = container.querySelector(
            ".kanban-swimlane .kanban-table-body",
        ) as HTMLElement;
        const headerInner = container.querySelector(
            ".kanban-table-header .kanban-table-inner",
        ) as HTMLElement;
        Object.defineProperty(body, "scrollLeft", {
            configurable: true,
            value: 99,
        });
        body.dispatchEvent(new Event("scroll"));
        expect(headerInner.style.transform).toBe("");
    });
});
