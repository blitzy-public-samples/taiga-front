/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the React `KanbanApp` composition root
 * (app/react/kanban/KanbanApp.tsx).
 *
 * Runs in the browserless jsdom environment (jest.config.js). EVERY `../shared/**`
 * transport is mocked so no real `fetch`/WebSocket is touched, and the heavy
 * presentational child (`KanbanBoard`) is stubbed with its props captured so the
 * test can drive KanbanApp's own control flow (board callbacks, DnD resolve /
 * persist, lightbox) directly.
 *
 * The REAL `useKanbanState` hook is used (it is a pure reducer with its own
 * dedicated spec) and the REAL `buildContainerKey` helper, so state transitions
 * and container-key math are exercised end-to-end. `bulkUpdateKanbanOrder` is
 * kept REAL (only `listUserstories`/`bulkCreate` are stubbed) so the EXACT
 * `bulk_update_kanban_order` request body is asserted through the mocked
 * `httpPost` — the AAP validation checklist requires this.
 *
 * Mandated scenarios (per the file's validation checklist), plus a broad battery
 * covering the pure helpers, the render shell, every control, the WebSocket
 * callbacks, and each board callback:
 *  (a) projectId = NaN            -> NO network call and NO WebSocket connect
 *  (b) is_kanban_activated:false  -> renders permission-denied, no board fetch
 *  (c) happy path                 -> loads project/swimlanes/userstories; board
 *  (d) drag persist               -> POST body omits swimlane_id for the `-1`
 *                                    sentinel, includes it for a real swimlane,
 *                                    and carries exactly one of after/before
 */

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";

import {
    KanbanApp,
    parseContainerKey,
    resolveKanbanDrop,
    zoomKeysFor,
} from "../KanbanApp";
import type { KanbanBoardProps } from "../KanbanBoard";
import { UNCLASSIFIED_SWIMLANE_ID } from "../useKanbanState";
import type {
    KanbanProject,
    KanbanState,
    Status,
    Swimlane,
    UserStoryModel,
} from "../useKanbanState";
import type {
    DropNeighbors,
    NormalizedDragEnd,
    ResolvedDrop,
} from "../../shared/dnd/DndProvider";

import { httpGet, httpPost, httpDelete } from "../../shared/api/httpClient";
import { listUserstories, bulkCreate } from "../../shared/api/userstories";
import { createEventsClient } from "../../shared/events/websocket";

/* -------------------------------------------------------------------------- */
/* Module mocks. Variables referenced inside a jest.mock factory MUST be       */
/* `mock`-prefixed (ts-jest hoists the factory above the imports).             */
/* -------------------------------------------------------------------------- */

// Reusable events-client stub so the test can assert connect/subscribe/cleanup.
const mockEventsClient = {
    connect: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    disconnect: jest.fn(),
};

// Captures the props KanbanApp drills into the (stubbed) KanbanBoard so the
// test can invoke the contract callbacks without a real child render.
const mockCaptured: { boardProps: KanbanBoardProps | null } = {
    boardProps: null,
};

jest.mock("../../shared/api/httpClient", () => {
    // A real HttpError class so any `instanceof HttpError` checks in the graph
    // behave exactly as in production.
    class HttpError extends Error {
        public status: number;
        public statusText: string;
        public body: unknown;
        public url: string;
        constructor(status: number, statusText: string, body: unknown, url: string) {
            super(`HTTP ${status} ${statusText}`);
            this.name = "HttpError";
            this.status = status;
            this.statusText = statusText;
            this.body = body;
            this.url = url;
            Object.setPrototypeOf(this, HttpError.prototype);
        }
    }
    return {
        __esModule: true,
        httpGet: jest.fn(),
        httpPost: jest.fn(),
        httpPut: jest.fn(),
        httpPatch: jest.fn(),
        httpDelete: jest.fn(),
        HttpError,
    };
});

// Keep `bulkUpdateKanbanOrder` REAL (spread from the actual module) so its POST
// body — built from the mocked `httpPost` — can be asserted. Only the two
// controllable adapters are stubbed.
jest.mock("../../shared/api/userstories", () => {
    const actual = jest.requireActual("../../shared/api/userstories") as Record<
        string,
        unknown
    >;
    return {
        __esModule: true,
        ...actual,
        listUserstories: jest.fn(),
        bulkCreate: jest.fn(),
    };
});

jest.mock("../../shared/events/websocket", () => ({
    __esModule: true,
    createEventsClient: jest.fn(() => mockEventsClient),
}));

jest.mock("../KanbanBoard", () => {
    const react = jest.requireActual("react") as typeof import("react");
    return {
        __esModule: true,
        KanbanBoard: (props: KanbanBoardProps) => {
            mockCaptured.boardProps = props;
            return react.createElement("div", {
                "data-testid": "kanban-board-mock",
            });
        },
    };
});

/* -------------------------------------------------------------------------- */
/* Typed handles to the mocked functions                                       */
/* -------------------------------------------------------------------------- */

type AsyncMock = jest.MockedFunction<
    (...args: readonly unknown[]) => Promise<unknown>
>;
const mockHttpGet = httpGet as unknown as AsyncMock;
const mockHttpPost = httpPost as unknown as AsyncMock;
const mockHttpDelete = httpDelete as unknown as AsyncMock;
const mockListUserstories = listUserstories as unknown as AsyncMock;
const mockBulkCreate = bulkCreate as unknown as AsyncMock;
const mockCreateEventsClient = createEventsClient as unknown as jest.Mock;

/* -------------------------------------------------------------------------- */
/* Test data factories                                                         */
/* -------------------------------------------------------------------------- */

const PROJECT_ID = 5;

function mkRes<T>(
    data: T,
    headers: Record<string, string> = {},
): { data: T; status: number; headers: Headers } {
    return { data, status: 200, headers: new Headers(headers) };
}

function makeStatus(id: number, order: number): Status {
    return {
        id,
        name: `Status ${id}`,
        color: "#ffffff",
        order,
        is_archived: false,
        wip_limit: null,
    };
}

function makeProject(overrides: Partial<KanbanProject> = {}): KanbanProject {
    return {
        id: PROJECT_ID,
        slug: "my-project",
        name: "My Project",
        is_kanban_activated: true,
        my_permissions: ["add_us", "modify_us"],
        // Intentionally unsorted so the `sortBy(us_statuses, "order")` path runs.
        us_statuses: [makeStatus(200, 2), makeStatus(100, 1)],
        members: [{ id: 9, username: "alice" }],
        ...overrides,
    };
}

function makeUs(overrides: Partial<UserStoryModel> = {}): UserStoryModel {
    return {
        id: 1,
        status: 100,
        swimlane: null,
        kanban_order: 0,
        subject: "A story",
        ...overrides,
    };
}

function dragEnd(
    activeId: number,
    overId: number | string | null,
): NormalizedDragEnd {
    // resolveKanbanDrop only reads activeId/overId; the raw dnd-kit event is unused.
    return { activeId, overId, event: {} as unknown as DragEndEvent };
}

function makeState(overrides: Partial<KanbanState> = {}): KanbanState {
    return {
        project: null,
        swimlanes: [],
        usersById: {},
        userstoriesRaw: [],
        order: {},
        usByStatus: {},
        usMap: {},
        swimlanesList: [],
        usByStatusSwimlanes: {},
        swimlanesStatuses: {},
        archivedStatus: [],
        statusHide: [],
        foldStatusChanged: {},
        ...overrides,
    };
}

/* -------------------------------------------------------------------------- */
/* Per-test wiring (mutable fixtures the http mock reads lazily)               */
/* -------------------------------------------------------------------------- */

let currentProject: KanbanProject;
let currentSwimlanes: Swimlane[];
let currentUserstories: UserStoryModel[];

/** Route `httpGet` by path, mirroring the endpoints KanbanApp calls. */
function installHappyHttp(): void {
    mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
        const path = String(args[0]);
        if (path.startsWith("/projects/")) {
            return Promise.resolve(mkRes(currentProject));
        }
        if (path === "/swimlanes") {
            return Promise.resolve(mkRes(currentSwimlanes));
        }
        return Promise.resolve(mkRes({}));
    });
    mockListUserstories.mockImplementation(() =>
        Promise.resolve(mkRes(currentUserstories)),
    );
    mockBulkCreate.mockImplementation(() => Promise.resolve(mkRes([])));
    mockHttpPost.mockImplementation(() => Promise.resolve(mkRes([])));
    mockHttpDelete.mockImplementation(() => Promise.resolve(mkRes({})));
}

beforeEach(() => {
    mockCaptured.boardProps = null;
    currentProject = makeProject();
    currentSwimlanes = [];
    currentUserstories = [
        makeUs({ id: 1, status: 100, kanban_order: 0 }),
        makeUs({ id: 2, status: 100, kanban_order: 1 }),
    ];
    installHappyHttp();
    mockCreateEventsClient.mockReturnValue(mockEventsClient);
});

async function renderLoaded(
    projectId: number = PROJECT_ID,
): Promise<ReturnType<typeof render>> {
    const utils = render(
        <KanbanApp projectId={projectId} projectSlug="my-project" />,
    );
    await waitFor(() => expect(mockCaptured.boardProps).not.toBeNull());
    return utils;
}

/* ========================================================================== */
/* Pure helpers                                                               */
/* ========================================================================== */

describe("zoomKeysFor", () => {
    it("returns only level-0 keys at level 0", () => {
        expect(zoomKeysFor(0)).toEqual(["assigned_to", "ref"]);
    });

    it("cumulatively concatenates through the requested level", () => {
        expect(zoomKeysFor(1)).toEqual([
            "assigned_to",
            "ref",
            "subject",
            "card-data",
            "assigned_to_extended",
        ]);
    });

    it("returns all keys at the max level (3)", () => {
        expect(zoomKeysFor(3)).toEqual([
            "assigned_to",
            "ref",
            "subject",
            "card-data",
            "assigned_to_extended",
            "tags",
            "extra_info",
            "unfold",
            "related_tasks",
            "attachments",
        ]);
    });

    it("clamps a too-high level down to the max", () => {
        expect(zoomKeysFor(99)).toEqual(zoomKeysFor(3));
    });

    it("clamps a negative level up to 0", () => {
        expect(zoomKeysFor(-5)).toEqual(zoomKeysFor(0));
    });

    it("treats a non-finite level as 0", () => {
        expect(zoomKeysFor(NaN)).toEqual(["assigned_to", "ref"]);
    });
});

describe("parseContainerKey", () => {
    it("parses a status::swimlane key with a real swimlane", () => {
        expect(parseContainerKey("100::50")).toEqual({
            statusId: 100,
            swimlaneId: 50,
        });
    });

    it("parses a status::-1 unclassified key", () => {
        expect(parseContainerKey("100::-1")).toEqual({
            statusId: 100,
            swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
        });
    });

    it("falls back to the unclassified sentinel when there is no separator", () => {
        expect(parseContainerKey("100")).toEqual({
            statusId: 100,
            swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
        });
    });
});

describe("resolveKanbanDrop", () => {
    it("returns null when overId is null", () => {
        const state = makeState({ usByStatus: { "100": [1, 2, 3] } });
        expect(resolveKanbanDrop(state, dragEnd(1, null))).toBeNull();
    });

    it("returns null when the dragged card has no known origin", () => {
        const state = makeState({ usByStatus: { "100": [1, 2, 3] } });
        expect(resolveKanbanDrop(state, dragEnd(999, 2))).toBeNull();
    });

    it("returns null when a numeric overId card is unknown", () => {
        const state = makeState({ usByStatus: { "100": [1, 2, 3] } });
        expect(resolveKanbanDrop(state, dragEnd(1, 888))).toBeNull();
    });

    it("reorders within a column when dropping onto a later card", () => {
        const state = makeState({ usByStatus: { "100": [1, 2, 3] } });
        const result = resolveKanbanDrop(state, dragEnd(1, 3));
        expect(result).not.toBeNull();
        expect(result?.origin).toEqual({ containerKey: "100::-1", index: 0 });
        expect(result?.target.containerKey).toBe("100::-1");
        expect(result?.orderedIds).toEqual([2, 1, 3]);
        expect(result?.draggedIds).toEqual([1]);
    });

    it("reorders toward the front when dropping onto an earlier card", () => {
        const state = makeState({ usByStatus: { "100": [1, 2, 3] } });
        const result = resolveKanbanDrop(state, dragEnd(3, 1));
        expect(result?.orderedIds).toEqual([3, 1, 2]);
        expect(result?.target.index).toBe(0);
    });

    it("appends to the end when dropping onto a container key", () => {
        const state = makeState({
            usByStatus: { "100": [1, 2, 3], "200": [4] },
        });
        const result = resolveKanbanDrop(state, dragEnd(1, "200::-1"));
        expect(result?.target.containerKey).toBe("200::-1");
        expect(result?.orderedIds).toEqual([4, 1]);
        expect(result?.target.index).toBe(1);
    });

    it("resolves across swimlane containers in swimlane mode", () => {
        const state = makeState({
            swimlanesList: [
                { id: 50, name: "S50" },
                { id: 60, name: "S60" },
            ],
            swimlanesStatuses: {
                50: [makeStatus(100, 1)],
                60: [makeStatus(100, 1)],
            },
            usByStatusSwimlanes: {
                50: { 100: [10, 11] },
                60: { 100: [12] },
            },
        });
        const result = resolveKanbanDrop(state, dragEnd(10, "100::60"));
        expect(result?.origin).toEqual({ containerKey: "100::50", index: 0 });
        expect(result?.target.containerKey).toBe("100::60");
        expect(result?.orderedIds).toEqual([12, 10]);
    });
});

/* ========================================================================== */
/* Component — lifecycle and gates                                            */
/* ========================================================================== */

describe("KanbanApp — transient NaN tolerance", () => {
    it("performs NO network call and NO WebSocket connect while projectId is NaN, but still renders the chrome", async () => {
        await act(async () => {
            render(<KanbanApp projectId={NaN} projectSlug="my-project" />);
        });
        expect(mockHttpGet).not.toHaveBeenCalled();
        expect(mockListUserstories).not.toHaveBeenCalled();
        expect(mockCreateEventsClient).not.toHaveBeenCalled();
        expect(mockCaptured.boardProps).toBeNull();
        expect(document.querySelector("section.main.kanban")).not.toBeNull();
        expect(document.querySelector(".board-zoom")).not.toBeNull();
    });
});

describe("KanbanApp — module gate", () => {
    it("renders permission-denied and loads no board when is_kanban_activated is false", async () => {
        currentProject = makeProject({ is_kanban_activated: false });
        render(<KanbanApp projectId={PROJECT_ID} projectSlug="my-project" />);
        await waitFor(() =>
            expect(document.querySelector(".permission-denied")).not.toBeNull(),
        );
        expect(mockCaptured.boardProps).toBeNull();
        // Only the project GET happened; no swimlanes / userstories were fetched.
        expect(mockListUserstories).not.toHaveBeenCalled();
    });

    it("surfaces a load error when the project request rejects", async () => {
        mockHttpGet.mockRejectedValue(new Error("boom"));
        render(<KanbanApp projectId={PROJECT_ID} projectSlug="my-project" />);
        await waitFor(() =>
            expect(document.querySelector(".kanban-load-error")).not.toBeNull(),
        );
        expect(mockCaptured.boardProps).toBeNull();
    });
});

describe("KanbanApp — happy load", () => {
    it("loads the project, swimlanes and userstories and renders the board", async () => {
        await renderLoaded();
        expect(mockHttpGet).toHaveBeenCalledWith(`/projects/${PROJECT_ID}`);
        expect(mockHttpGet).toHaveBeenCalledWith("/swimlanes", {
            project: PROJECT_ID,
        });
        expect(mockListUserstories).toHaveBeenCalledWith(
            PROJECT_ID,
            expect.objectContaining({ status__is_archived: false }),
        );
        expect(document.querySelector('[data-testid="kanban-board-mock"]')).not.toBeNull();
        expect(mockCaptured.boardProps?.project.name).toBe("My Project");
    });

    it("sorts us_statuses by order before handing them to the board", async () => {
        await renderLoaded();
        const statuses = mockCaptured.boardProps?.project.us_statuses as Status[];
        expect(statuses.map((s) => s.id)).toEqual([100, 200]);
    });

    it("derives canAddUs=true when my_permissions includes add_us", async () => {
        await renderLoaded();
        expect(mockCaptured.boardProps?.canAddUs).toBe(true);
    });

    it("derives canAddUs=false when my_permissions lacks add_us", async () => {
        currentProject = makeProject({ my_permissions: ["view_us"] });
        await renderLoaded();
        expect(mockCaptured.boardProps?.canAddUs).toBe(false);
    });

    it("enters swimlane mode (class + swimlaneList) when swimlanes are present", async () => {
        currentSwimlanes = [{ id: 50, name: "Backend", statuses: [makeStatus(100, 1)] }];
        currentUserstories = [makeUs({ id: 1, status: 100, swimlane: 50, kanban_order: 0 })];
        await renderLoaded();
        await waitFor(() =>
            expect(document.querySelector("section.main.kanban.swimlane")).not.toBeNull(),
        );
    });
});

/* ========================================================================== */
/* Component — controls (filter / zoom / search)                              */
/* ========================================================================== */

describe("KanbanApp — controls", () => {
    it("toggles the filter panel and the manager's expanded modifier", async () => {
        await renderLoaded();
        expect(document.querySelector(".kanban-manager.expanded")).not.toBeNull();
        expect(document.querySelector(".kanban-filter")).toBeNull();

        const filterBtn = document.querySelector(".btn-filter") as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(filterBtn);
        });
        expect(document.querySelector(".kanban-filter")).not.toBeNull();
        expect(document.querySelector(".kanban-manager.expanded")).toBeNull();
        expect(document.querySelector(".btn-filter.active")).not.toBeNull();
    });

    it("reloads with attachments/tasks when zoom crosses above level 2", async () => {
        await renderLoaded();
        const before = mockListUserstories.mock.calls.length;
        const zoomBtns = document.querySelectorAll(".board-zoom .zoom-level");
        await act(async () => {
            fireEvent.click(zoomBtns[3]);
        });
        await waitFor(() =>
            expect(mockListUserstories).toHaveBeenCalledWith(
                PROJECT_ID,
                expect.objectContaining({
                    include_attachments: 1,
                    include_tasks: 1,
                }),
            ),
        );
        expect(mockListUserstories.mock.calls.length).toBeGreaterThan(before);
        expect(mockCaptured.boardProps?.zoomLevel).toBe(3);
    });

    it("does not reload when clicking the already-active zoom level", async () => {
        await renderLoaded();
        const before = mockListUserstories.mock.calls.length;
        const zoomBtns = document.querySelectorAll(".board-zoom .zoom-level");
        await act(async () => {
            // Default zoom level is 1 -> clicking index 1 is a no-op.
            fireEvent.click(zoomBtns[1]);
        });
        expect(mockListUserstories.mock.calls.length).toBe(before);
    });

    it("updates zoom keys without reloading when staying at or below level 2", async () => {
        await renderLoaded();
        const before = mockListUserstories.mock.calls.length;
        const zoomBtns = document.querySelectorAll(".board-zoom .zoom-level");
        await act(async () => {
            fireEvent.click(zoomBtns[2]);
        });
        expect(mockCaptured.boardProps?.zoomLevel).toBe(2);
        expect(mockListUserstories.mock.calls.length).toBe(before);
    });

    it("debounces search input and reloads with the query", async () => {
        await renderLoaded();
        const search = document.querySelector(".kanban-search") as HTMLInputElement;
        await act(async () => {
            fireEvent.change(search, { target: { value: "login" } });
        });
        await waitFor(() =>
            expect(mockListUserstories).toHaveBeenCalledWith(
                PROJECT_ID,
                expect.objectContaining({ q: "login" }),
            ),
        );
    });
});

/* ========================================================================== */
/* Component — WebSocket subscription                                         */
/* ========================================================================== */

describe("KanbanApp — WebSocket", () => {
    async function loadAndGetCallbacks(): Promise<{
        usCb: (data: unknown) => void;
        projCb: (data: unknown) => void;
        unmount: () => void;
    }> {
        const utils = await renderLoaded();
        await waitFor(() => expect(mockEventsClient.connect).toHaveBeenCalled());
        const calls = mockEventsClient.subscribe.mock.calls as Array<
            [string, (data: unknown) => void]
        >;
        const usEntry = calls.find((c) => c[0].endsWith(".userstories"));
        const projEntry = calls.find((c) => c[0].endsWith(".projects"));
        return {
            usCb: usEntry![1],
            projCb: projEntry![1],
            unmount: utils.unmount,
        };
    }

    it("connects and subscribes to the userstories and projects keys after load", async () => {
        await renderLoaded();
        await waitFor(() => expect(mockEventsClient.connect).toHaveBeenCalledTimes(1));
        expect(mockEventsClient.subscribe).toHaveBeenCalledWith(
            `changes.project.${PROJECT_ID}.userstories`,
            expect.any(Function),
        );
        expect(mockEventsClient.subscribe).toHaveBeenCalledWith(
            `changes.project.${PROJECT_ID}.projects`,
            expect.any(Function),
        );
    });

    it("reloads userstories when the userstories event fires", async () => {
        const { usCb } = await loadAndGetCallbacks();
        const before = mockListUserstories.mock.calls.length;
        await act(async () => {
            usCb({});
        });
        await waitFor(() =>
            expect(mockListUserstories.mock.calls.length).toBeGreaterThan(before),
        );
    });

    it("performs a full refresh on a matching projects event", async () => {
        const { projCb } = await loadAndGetCallbacks();
        const before = mockHttpGet.mock.calls.filter((c) =>
            String(c[0]).startsWith("/projects/"),
        ).length;
        await act(async () => {
            projCb({ matches: "projects.swimlane" });
        });
        await waitFor(() =>
            expect(
                mockHttpGet.mock.calls.filter((c) =>
                    String(c[0]).startsWith("/projects/"),
                ).length,
            ).toBeGreaterThan(before),
        );
    });

    it("ignores a non-matching projects event", async () => {
        const { projCb } = await loadAndGetCallbacks();
        const before = mockHttpGet.mock.calls.filter((c) =>
            String(c[0]).startsWith("/projects/"),
        ).length;
        await act(async () => {
            projCb({ matches: "projects.something_else" });
        });
        expect(
            mockHttpGet.mock.calls.filter((c) =>
                String(c[0]).startsWith("/projects/"),
            ).length,
        ).toBe(before);
    });

    it("unsubscribes both keys and disconnects on unmount", async () => {
        const { unmount } = await loadAndGetCallbacks();
        await act(async () => {
            unmount();
        });
        expect(mockEventsClient.unsubscribe).toHaveBeenCalledWith(
            `changes.project.${PROJECT_ID}.userstories`,
        );
        expect(mockEventsClient.unsubscribe).toHaveBeenCalledWith(
            `changes.project.${PROJECT_ID}.projects`,
        );
        expect(mockEventsClient.disconnect).toHaveBeenCalledTimes(1);
    });
});

/* ========================================================================== */
/* Component — bulk create lightbox                                           */
/* ========================================================================== */

describe("KanbanApp — bulk create", () => {
    it("opens the bulk lightbox and creates stories through bulk_create then reloads", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        const textarea = document.querySelector(
            ".bulk-subjects",
        ) as HTMLTextAreaElement;
        expect(textarea).not.toBeNull();
        await act(async () => {
            fireEvent.change(textarea, { target: { value: "Story A\nStory B" } });
        });
        const submit = document.querySelector(".btn-submit") as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(submit);
        });
        expect(mockBulkCreate).toHaveBeenCalledWith(
            PROJECT_ID,
            100,
            "Story A\nStory B",
            null,
        );
    });

    it("does not call bulk_create when the textarea is empty (whitespace only)", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("standard", 200);
        });
        const submit = document.querySelector(".btn-submit") as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(submit);
        });
        expect(mockBulkCreate).not.toHaveBeenCalled();
        // Lightbox closes after submit regardless.
        expect(document.querySelector(".bulk-subjects")).toBeNull();
    });

    it("closes the bulk lightbox without creating when Close is clicked", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        expect(document.querySelector(".bulk-subjects")).not.toBeNull();
        const close = document.querySelector(".btn-close") as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(close);
        });
        expect(document.querySelector(".bulk-subjects")).toBeNull();
        expect(mockBulkCreate).not.toHaveBeenCalled();
    });
});

/* ========================================================================== */
/* Component — drag persist (exact bulk_update_kanban_order body)             */
/* ========================================================================== */

describe("KanbanApp — drag persist", () => {
    const resolvedFor = (containerKey: string): ResolvedDrop => ({
        origin: { containerKey: "100::-1", index: 0 },
        target: { containerKey, index: 1 },
        orderedIds: [2, 1],
        draggedIds: [1],
    });

    it("omits swimlane_id for the -1 sentinel and sends after_userstory_id", async () => {
        await renderLoaded();
        const neighbors: DropNeighbors = { previous: 2, next: null };
        await act(async () => {
            await mockCaptured.boardProps?.persist(resolvedFor("100::-1"), neighbors);
        });
        const call = mockHttpPost.mock.calls.find(
            (c) => c[0] === "/userstories/bulk_update_kanban_order",
        );
        expect(call).toBeDefined();
        expect(call?.[1]).toEqual({
            project_id: PROJECT_ID,
            status_id: 100,
            bulk_userstories: [1],
            after_userstory_id: 2,
        });
    });

    it("includes swimlane_id for a real swimlane and sends before_userstory_id", async () => {
        await renderLoaded();
        const neighbors: DropNeighbors = { previous: null, next: 9 };
        await act(async () => {
            await mockCaptured.boardProps?.persist(resolvedFor("100::50"), neighbors);
        });
        const call = mockHttpPost.mock.calls.find(
            (c) => c[0] === "/userstories/bulk_update_kanban_order",
        );
        expect(call).toBeDefined();
        expect(call?.[1]).toEqual({
            project_id: PROJECT_ID,
            status_id: 100,
            bulk_userstories: [1],
            before_userstory_id: 9,
            swimlane_id: 50,
        });
    });

    it("marks the dropped stories as moved (movedUs) for the highlight window", async () => {
        await renderLoaded();
        const neighbors: DropNeighbors = { previous: 2, next: null };
        await act(async () => {
            await mockCaptured.boardProps?.persist(resolvedFor("100::-1"), neighbors);
        });
        expect(mockCaptured.boardProps?.movedUs).toEqual([1]);
    });

    it("exposes a resolveDrop that delegates to resolveKanbanDrop (null over -> null)", async () => {
        await renderLoaded();
        expect(mockCaptured.boardProps?.resolveDrop(dragEnd(1, null))).toBeNull();
    });
});

/* ========================================================================== */
/* Component — remaining board callbacks                                      */
/* ========================================================================== */

describe("KanbanApp — board callbacks", () => {
    it("folds a status column and clears the unfold target", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onFoldStatus?.(makeStatus(100, 1));
        });
        expect(mockCaptured.boardProps?.folds[100]).toBe(true);
        expect(mockCaptured.boardProps?.unfold).toBeNull();
    });

    it("unfolds a status column again on a second toggle", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onFoldStatus?.(makeStatus(100, 1));
        });
        await act(async () => {
            mockCaptured.boardProps?.onFoldStatus?.(makeStatus(100, 1));
        });
        expect(mockCaptured.boardProps?.folds[100]).toBe(false);
        expect(mockCaptured.boardProps?.unfold).toBe(100);
    });

    it("toggles a swimlane's folded state", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onToggleSwimlane?.(50);
        });
        expect(mockCaptured.boardProps?.foldedSwimlane[50]).toBe(true);
    });

    it("forwards a fold toggle into the kanban state without throwing", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onToggleFold?.(1);
        });
        expect(mockCaptured.boardProps).not.toBeNull();
    });

    it("deletes a user story after confirmation and reloads", async () => {
        const confirmSpy = jest
            .spyOn(window, "confirm")
            .mockReturnValue(true);
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickDelete?.(1);
        });
        expect(mockHttpDelete).toHaveBeenCalledWith("/userstories/1");
        confirmSpy.mockRestore();
    });

    it("does not delete when the confirmation is declined", async () => {
        const confirmSpy = jest
            .spyOn(window, "confirm")
            .mockReturnValue(false);
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickDelete?.(1);
        });
        expect(mockHttpDelete).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it("reports isArchivedHidden=false for an unknown user story", async () => {
        await renderLoaded();
        expect(mockCaptured.boardProps?.isArchivedHidden?.(999999)).toBe(false);
    });

    it("shows the placeholder only for the first status when the board is empty", async () => {
        currentUserstories = [];
        await renderLoaded();
        expect(mockCaptured.boardProps?.showPlaceholder?.(100, null)).toBe(true);
        expect(mockCaptured.boardProps?.showPlaceholder?.(200, null)).toBe(false);
    });
});
