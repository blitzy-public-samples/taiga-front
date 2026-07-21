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
    validateBulkText,
    firstUsInColumn,
    hasUnclassifiedStories,
} from "../KanbanApp";
import type { KanbanBoardProps } from "../KanbanBoard";
import { UNCLASSIFIED_SWIMLANE_ID } from "../useKanbanState";
import {
    loadColumnFolds,
    loadKanbanFilters,
    loadSwimlaneFolds,
    saveColumnFolds,
    saveKanbanFilters,
    saveSwimlaneFolds,
} from "../persistence";
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

import { httpGet, httpPost, httpDelete, httpPatch, HttpError } from "../../shared/api/httpClient";
import { listUserstories, bulkCreate } from "../../shared/api/userstories";
import { createEventsClient } from "../../shared/events/websocket";

// WebSocket-driven board refreshes are coalesced through a PURE-TRAILING lodash
// debounce (EVENTS_DEBOUNCE_MS = 1000ms in KanbanApp, matching the AngularJS
// `debounceLeading` = {leading:false, trailing:true}). A burst of events therefore
// produces exactly ONE reload, on the trailing edge after the burst settles — no
// leading (immediate) reload. Assertions on the post-event reload must poll past
// that window, so give them a timeout comfortably larger than the debounce.
const WS_REFRESH_TIMEOUT = 3000;

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
    // Faithful port of the real `isVersionConflict` (httpClient.ts), implemented
    // here against THIS factory's local `HttpError` so `instanceof` matches the
    // errors the SUT catches. [W1-1] A version conflict is HTTP 400 with a
    // {"version": ...} body (WrongArguments -> BadRequest), 409 tolerated too.
    const isVersionConflict = (err: unknown): boolean => {
        if (!(err instanceof HttpError)) {
            return false;
        }
        if (err.status === 409) {
            return true;
        }
        return (
            err.status === 400 &&
            typeof err.body === "object" &&
            err.body !== null &&
            "version" in (err.body as Record<string, unknown>)
        );
    };
    return {
        __esModule: true,
        httpGet: jest.fn(),
        httpPost: jest.fn(),
        httpPut: jest.fn(),
        httpPatch: jest.fn(),
        httpDelete: jest.fn(),
        HttpError,
        isVersionConflict,
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
const mockHttpPatch = httpPatch as unknown as AsyncMock;
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
// Fixture returned for `GET /userstories/filters_data` (the `filtersData` adapter
// is kept REAL, so it flows through the mocked `httpGet`). Mirrors the shape of
// the Django `filters_data` payload consumed by `buildKanbanFilterCategories`.
let currentFiltersData: Record<string, unknown>;

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
        if (path === "/userstories/filters_data") {
            return Promise.resolve(mkRes(currentFiltersData));
        }
        return Promise.resolve(mkRes({}));
    });
    mockListUserstories.mockImplementation(() =>
        Promise.resolve(mkRes(currentUserstories)),
    );
    mockBulkCreate.mockImplementation(() => Promise.resolve(mkRes([])));
    mockHttpPost.mockImplementation(() => Promise.resolve(mkRes([])));
    mockHttpDelete.mockImplementation(() => Promise.resolve(mkRes({})));
    mockHttpPatch.mockImplementation(() => Promise.resolve(mkRes({})));
}

beforeEach(() => {
    mockCaptured.boardProps = null;
    // KanbanApp now restores fold/filter view preferences from localStorage on
    // load (QA-FUNC-03 / QA-FUNC-09). Clear it before every test so a persisted
    // preference from one test can never leak into another.
    window.localStorage.clear();
    currentProject = makeProject();
    currentSwimlanes = [];
    currentUserstories = [
        makeUs({ id: 1, status: 100, kanban_order: 0 }),
        makeUs({ id: 2, status: 100, kanban_order: 1 }),
    ];
    currentFiltersData = {};
    installHappyHttp();
    mockCreateEventsClient.mockReturnValue(mockEventsClient);
    // No Angular injector is present unless a test installs one.
    delete (window as unknown as { angular?: unknown }).angular;
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

    /* ---- multi-select group drag (QA-FUNC-01) ------------------------------ */

    it("moves only the single dragged card when the selection has one member", () => {
        // A one-card selection is NOT a group; behavior is bit-for-bit identical
        // to the no-selection single-item path.
        const state = makeState({ usByStatus: { "100": [1, 2, 3] } });
        const withSel = resolveKanbanDrop(state, dragEnd(1, 3), [1]);
        const withoutSel = resolveKanbanDrop(state, dragEnd(1, 3));
        expect(withSel?.draggedIds).toEqual([1]);
        expect(withSel?.orderedIds).toEqual(withoutSel?.orderedIds);
        expect(withSel?.target).toEqual(withoutSel?.target);
    });

    it("moves the WHOLE multi-selection contiguously to the drop point (QA-FUNC-01)", () => {
        // Selection {1,3}; drag card 1 onto card 4. Both selected cards travel
        // together to the drop location in board reading order, and BOTH ids are
        // reported so the bulk-order endpoint receives bulk_userstories > 1.
        const state = makeState({ usByStatus: { "100": [1, 2, 3, 4] } });
        const result = resolveKanbanDrop(state, dragEnd(1, 4), [1, 3]);
        expect(result?.draggedIds).toEqual([1, 3]);
        expect(result?.draggedIds.length).toBeGreaterThan(1);
        expect(result?.orderedIds).toEqual([2, 1, 3, 4]);
    });

    it("moves the group only when the dragged card is part of the selection", () => {
        // Dragging a NON-selected card (1) while {2,3} are selected must NOT drag
        // the selection — only the single dragged card moves.
        const state = makeState({ usByStatus: { "100": [1, 2, 3, 4] } });
        const result = resolveKanbanDrop(state, dragEnd(1, 4), [2, 3]);
        expect(result?.draggedIds).toEqual([1]);
    });

    it("carries every selected card across columns as a group (QA-FUNC-01)", () => {
        // Selection spans two columns {1 in 100, 3 in 200}; dragging 1 onto the
        // 200 container moves BOTH into 200, reported as one bulk group.
        const state = makeState({
            usByStatus: { "100": [1, 2], "200": [3, 4] },
        });
        const result = resolveKanbanDrop(state, dragEnd(1, "200::-1"), [1, 3]);
        expect(result?.target.containerKey).toBe("200::-1");
        expect(result?.draggedIds).toEqual([1, 3]);
        expect(result?.orderedIds).toEqual([4, 1, 3]);
    });
});

/* ========================================================================== */
/* Pure helpers — bulk lightbox (QA-FUNC-04/05/07)                            */
/* ========================================================================== */

describe("validateBulkText (QA-FUNC-07)", () => {
    it("rejects an empty / whitespace-only value with the REQUIRED message", () => {
        expect(validateBulkText("")).toBe("This value is required.");
        expect(validateBulkText("   \n  ")).toBe("This value is required.");
    });

    it("accepts a normal multi-line value", () => {
        expect(validateBulkText("Story A\nStory B")).toBeNull();
    });

    it("accepts a line of exactly 199 characters (strictly < 200)", () => {
        expect(validateBulkText("x".repeat(199))).toBeNull();
    });

    it("rejects a line of 200+ characters with the LINEWIDTH message", () => {
        const message = validateBulkText("x".repeat(200));
        expect(message).toBe(
            "One or more lines is perhaps too long. Try to keep under 200 characters.",
        );
        expect(validateBulkText("ok\n" + "y".repeat(250))).toBe(
            "One or more lines is perhaps too long. Try to keep under 200 characters.",
        );
    });
});

describe("firstUsInColumn (QA-FUNC-04 top placement)", () => {
    it("returns the first id of a no-swimlane column", () => {
        const state = makeState({ usByStatus: { "100": [7, 8, 9] } });
        expect(firstUsInColumn(state, 100, null)).toBe(7);
    });

    it("returns null for an empty column", () => {
        const state = makeState({ usByStatus: { "100": [] } });
        expect(firstUsInColumn(state, 100, null)).toBeNull();
    });

    it("reads the swimlane bucket in swimlane mode", () => {
        const state = makeState({
            swimlanesList: [{ id: 50, name: "S50" }],
            usByStatusSwimlanes: { 50: { 100: [12, 13] } },
        });
        expect(firstUsInColumn(state, 100, 50)).toBe(12);
    });

    it("maps a null swimlane to the unclassified (-1) bucket in swimlane mode", () => {
        const state = makeState({
            swimlanesList: [{ id: 50, name: "S50" }],
            usByStatusSwimlanes: { [UNCLASSIFIED_SWIMLANE_ID]: { 100: [99] } },
        });
        expect(firstUsInColumn(state, 100, null)).toBe(99);
    });
});

describe("hasUnclassifiedStories (QA-FUNC-04 swimlane option)", () => {
    it("is true when the -1 bucket has stories", () => {
        const state = makeState({
            usByStatusSwimlanes: { [UNCLASSIFIED_SWIMLANE_ID]: { 100: [1] } },
        });
        expect(hasUnclassifiedStories(state)).toBe(true);
    });

    it("is false when the -1 bucket is absent or empty", () => {
        expect(hasUnclassifiedStories(makeState())).toBe(false);
        expect(
            hasUnclassifiedStories(
                makeState({
                    usByStatusSwimlanes: {
                        [UNCLASSIFIED_SWIMLANE_ID]: { 100: [] },
                    },
                }),
            ),
        ).toBe(false);
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
        // F-KANBAN-NO-MAIN: the Kanban screen root is a <main> landmark
        // (mirroring the Backlog `<main className="main scrum">`), not a <section>.
        expect(document.querySelector("main.main.kanban")).not.toBeNull();
        expect(document.querySelector(".board-zoom")).not.toBeNull();
    });
});

describe("KanbanApp — URL-slug resolution (QA: blank Kanban board)", () => {
    it("resolves the project from the URL slug via projects/by_slug when the host id is unusable, then loads and subscribes off the resolved id", async () => {
        // Production reality: the migrated Jade shell interpolates
        // data-project-id="{{project.id}}" to an EMPTY string once the AngularJS
        // KanbanController is gone, so `parseInt("")` yields NaN. The real slug
        // lives in the route URL (/project/:pslug/kanban), exactly as it does for
        // the Backlog root. The board must resolve the id from the slug and load
        // fully rather than render blank.
        const original = `${window.location.pathname}${window.location.search}`;
        window.history.replaceState(null, "", "/project/my-project/kanban");
        // Route by_slug (NO leading slash — matches the frozen contract path) to
        // the full project, exactly like the by-id endpoint; keep the
        // leading-slash routes the happy mock installs for swimlanes/filters.
        mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
            const path = String(args[0]);
            if (path === "projects/by_slug") {
                return Promise.resolve(mkRes(currentProject));
            }
            if (path.startsWith("/projects/")) {
                return Promise.resolve(mkRes(currentProject));
            }
            if (path === "/swimlanes") {
                return Promise.resolve(mkRes(currentSwimlanes));
            }
            if (path === "/userstories/filters_data") {
                return Promise.resolve(mkRes(currentFiltersData));
            }
            return Promise.resolve(mkRes({}));
        });
        try {
            render(<KanbanApp projectId={NaN} projectSlug="" />);
            await waitFor(() =>
                expect(mockCaptured.boardProps).not.toBeNull(),
            );

            // Resolution went through the by_slug endpoint with the URL slug…
            expect(mockHttpGet).toHaveBeenCalledWith("projects/by_slug", {
                slug: "my-project",
            });
            // …and NEVER through an invalid by-id path (…/projects/NaN or /0).
            const badById = mockHttpGet.mock.calls.filter((c: readonly unknown[]) =>
                /^\/projects\/(NaN|0)(\/|$)/.test(String(c[0])),
            );
            expect(badById).toHaveLength(0);
            // Downstream loaders keyed off the RESOLVED id (PROJECT_ID = 5).
            expect(mockListUserstories).toHaveBeenCalledWith(
                PROJECT_ID,
                expect.objectContaining({ status__is_archived: false }),
            );
            expect(mockHttpGet).toHaveBeenCalledWith("/swimlanes", {
                project: PROJECT_ID,
            });
            // …and the WebSocket subscribes on the resolved id's keys.
            expect(mockEventsClient.subscribe).toHaveBeenCalledWith(
                `changes.project.${PROJECT_ID}.userstories`,
                expect.any(Function),
            );
            expect(mockEventsClient.subscribe).toHaveBeenCalledWith(
                `changes.project.${PROJECT_ID}.projects`,
                expect.any(Function),
            );
        } finally {
            window.history.replaceState(null, "", original);
        }
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

    it("renders a VISIBLE permission-denied message, not a blank section (QA-FUNC-10)", async () => {
        currentProject = makeProject({ is_kanban_activated: false });
        render(<KanbanApp projectId={PROJECT_ID} projectSlug="my-project" />);
        await waitFor(() =>
            expect(document.querySelector(".permission-denied")).not.toBeNull(),
        );
        const section = document.querySelector(".permission-denied") as HTMLElement;
        // The section must NOT be empty — an explanatory message must render so
        // the user is not left facing a blank white viewport.
        const message = section.querySelector(".kanban-permission-denied-message");
        expect(message).not.toBeNull();
        expect(message).toHaveAttribute("role", "alert");
        expect(section.textContent).toContain("Permission denied");
        expect(section.textContent).toContain(
            "You don't have permission to access this page.",
        );
        // Must NOT collide with the generic 500 load-error state.
        expect(section.querySelector(".kanban-load-error")).toBeNull();
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

    it("derives canAddUs=false on an archived project even with add_us (QA-FUNC-11)", async () => {
        // AngularJS `projectService.canEdit(add_us)` returns false on an archived
        // project regardless of `my_permissions`, disabling the add-us buttons.
        currentProject = makeProject({
            my_permissions: ["add_us", "modify_us"],
            archived_code: "blocked-by-owner-leaving",
        });
        await renderLoaded();
        expect(mockCaptured.boardProps?.canAddUs).toBe(false);
    });

    it("enters swimlane mode (class + swimlaneList) when swimlanes are present", async () => {
        currentSwimlanes = [{ id: 50, name: "Backend", statuses: [makeStatus(100, 1)] }];
        currentUserstories = [makeUs({ id: 1, status: 100, swimlane: 50, kanban_order: 0 })];
        await renderLoaded();
        await waitFor(() =>
            // F-KANBAN-NO-MAIN: <main> landmark carries the swimlane modifier class.
            expect(document.querySelector("main.main.kanban.swimlane")).not.toBeNull(),
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
        const zoomBtns = document.querySelectorAll(".board-zoom .zoom-radio input");
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
        const zoomBtns = document.querySelectorAll(".board-zoom .zoom-radio input");
        await act(async () => {
            // Default zoom level is 1 -> clicking index 1 is a no-op.
            fireEvent.click(zoomBtns[1]);
        });
        expect(mockListUserstories.mock.calls.length).toBe(before);
    });

    it("updates zoom keys without reloading when staying at or below level 2", async () => {
        await renderLoaded();
        const before = mockListUserstories.mock.calls.length;
        const zoomBtns = document.querySelectorAll(".board-zoom .zoom-radio input");
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
        // Pure-trailing debounce: the reload fires on the trailing edge, so poll
        // past the debounce window.
        await waitFor(
            () =>
                expect(mockListUserstories.mock.calls.length).toBeGreaterThan(
                    before,
                ),
            { timeout: WS_REFRESH_TIMEOUT },
        );
    });

    it("[M-11] coalesces a burst of userstories events into a single trailing reload", async () => {
        const { usCb } = await loadAndGetCallbacks();
        const before = mockListUserstories.mock.calls.length;
        // Fire five events back-to-back within one tick, as an event storm would.
        await act(async () => {
            usCb({});
            usCb({});
            usCb({});
            usCb({});
            usCb({});
        });
        // Pure-trailing debounce: NOTHING fires synchronously on the leading edge
        // (Issue 2 — the pre-fix leading:true form issued an immediate reload per
        // burst, and the un-debounced form issued one PER event). The five events
        // coalesce into exactly ONE reload on the trailing edge once the burst
        // settles.
        expect(mockListUserstories.mock.calls.length).toBe(before);
        await waitFor(
            () =>
                expect(mockListUserstories.mock.calls.length).toBe(before + 1),
            { timeout: WS_REFRESH_TIMEOUT },
        );
        // And it stays at exactly one coalesced reload (no per-event fan-out).
        expect(mockListUserstories.mock.calls.length).toBe(before + 1);
    });

    it("[M-03] surfaces the shared error toast when a socket-triggered reload fails", async () => {
        const { usCb } = await loadAndGetCallbacks();
        // The board fetch (Promise.all) rejects on the userstories leg.
        mockListUserstories.mockRejectedValueOnce(new Error("reload boom"));
        await act(async () => {
            usCb({});
        });
        // Pure-trailing debounce defers the (failing) reload to the trailing edge.
        await waitFor(
            () =>
                expect(
                    document.querySelector(".kanban-notification-error"),
                ).not.toBeNull(),
            { timeout: WS_REFRESH_TIMEOUT },
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
        // Pure-trailing debounce: the full refresh fires on the trailing edge.
        await waitFor(
            () =>
                expect(
                    mockHttpGet.mock.calls.filter((c) =>
                        String(c[0]).startsWith("/projects/"),
                    ).length,
                ).toBeGreaterThan(before),
            { timeout: WS_REFRESH_TIMEOUT },
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

    it("clears a stale not-found empty-state on a project refresh (loadInitialData setNotFound symmetry)", async () => {
        // QA-FUNC (Issue #1b): `loadInitialData` must manage `notFound` exactly
        // like `reloadUserstories`. Pre-fix it never called `setNotFound`, so a
        // "no results" empty-state raised by a prior filtered reload stuck on the
        // board even after a full refresh repopulated it.
        const { projCb } = await loadAndGetCallbacks();
        // Faithfully mirror the real transport: each GET yields a FRESH object
        // reference (as fetch + JSON.parse does) so a second loadInitialData can
        // re-sort `us_statuses` (the default shared-reference mock is frozen by
        // immer after the first load). Userstories return empty first (search),
        // then repopulate for the refresh.
        let usEmpty = true;
        mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
            const path = String(args[0]);
            if (path.startsWith("/projects/") || path === "projects/by_slug") {
                return Promise.resolve(mkRes({ ...currentProject }));
            }
            if (path === "/swimlanes") {
                return Promise.resolve(mkRes(currentSwimlanes));
            }
            if (path === "/userstories/filters_data") {
                return Promise.resolve(mkRes(currentFiltersData));
            }
            return Promise.resolve(mkRes({}));
        });
        mockListUserstories.mockImplementation(() =>
            Promise.resolve(mkRes(usEmpty ? [] : currentUserstories)),
        );
        // Drive a search that returns no results -> reloadUserstories sets notFound.
        const search = document.querySelector(".kanban-search") as HTMLInputElement;
        await act(async () => {
            fireEvent.change(search, { target: { value: "zzz" } });
        });
        await waitFor(() => expect(mockCaptured.boardProps?.notFound).toBe(true), {
            timeout: WS_REFRESH_TIMEOUT,
        });
        // Results come back and a projects event fires a full refresh via
        // loadInitialData. The stale not-found placeholder must be cleared.
        usEmpty = false;
        await act(async () => {
            projCb({ matches: "projects.swimlane" });
        });
        await waitFor(
            () => expect(mockCaptured.boardProps?.notFound).toBe(false),
            { timeout: WS_REFRESH_TIMEOUT },
        );
    });

    it("does NOT tear down and recreate the socket on a data refresh (QA F2)", async () => {
        const { projCb } = await loadAndGetCallbacks();

        // Exactly one socket established after the initial load.
        expect(mockEventsClient.connect).toHaveBeenCalledTimes(1);
        const disconnectsBefore = mockEventsClient.disconnect.mock.calls.length;

        // Faithfully mirror the real transport: each `GET /projects/{id}` yields
        // a FRESH object reference (as fetch + JSON.parse does), so the refresh
        // sets a NEW `projectLoaded` object. Keying the WS effect on that object
        // (the pre-fix bug) would tear the socket down and recreate it here; the
        // stable projectId + "loaded" flag must not.
        mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
            const path = String(args[0]);
            if (path.startsWith("/projects/")) {
                return Promise.resolve(mkRes({ ...currentProject }));
            }
            if (path === "/swimlanes") {
                return Promise.resolve(mkRes(currentSwimlanes));
            }
            if (path === "/userstories/filters_data") {
                return Promise.resolve(mkRes(currentFiltersData));
            }
            return Promise.resolve(mkRes({}));
        });

        // A matching projects event triggers a FULL board refresh
        // (refreshAll → loadInitialData → setProjectLoaded(newObject)).
        const projectGetsBefore = mockHttpGet.mock.calls.filter((c) =>
            String(c[0]).startsWith("/projects/"),
        ).length;
        await act(async () => {
            projCb({ matches: "projects.swimlane" });
        });
        // Pure-trailing debounce: the full refresh fires on the trailing edge.
        await waitFor(
            () =>
                expect(
                    mockHttpGet.mock.calls.filter((c) =>
                        String(c[0]).startsWith("/projects/"),
                    ).length,
                ).toBeGreaterThan(projectGetsBefore),
            { timeout: WS_REFRESH_TIMEOUT },
        );

        // The refresh must NOT churn the WebSocket effect: the subscription
        // lifecycle keys on a stable projectId + "loaded" flag, so there is no
        // extra connect() and no disconnect() from a spurious effect re-run.
        expect(mockEventsClient.connect).toHaveBeenCalledTimes(1);
        expect(mockEventsClient.disconnect.mock.calls.length).toBe(disconnectsBefore);
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
/* Component — document.title / meta parity (F-001)                           */
/* ========================================================================== */

describe("KanbanApp — document.title / meta parity (F-001)", () => {
    afterEach(() => {
        // Do not leak a page title/description into unrelated specs.
        document.title = "";
        document.head
            .querySelectorAll('meta[name="description"]')
            .forEach((el) => el.remove());
    });

    it("sets the tab title to 'Kanban - <projectName>' once the project resolves", async () => {
        await renderLoaded();

        // No Angular injector in jsdom → t() uses the English fallback,
        // interpolating the fixture project name ("My Project").
        expect(document.title).toBe("Kanban - My Project");
    });

    it("sets a meta description that interpolates the project name", async () => {
        await renderLoaded();

        const description = document.head
            .querySelector('meta[name="description"]')
            ?.getAttribute("content");
        expect(description).toBeTruthy();
        expect(description).toContain("My Project");
        expect(description).toContain("kanban panel");
    });

    it("overrides a stale SPA-transition title when the board mounts (F-001 cure)", async () => {
        // Simulate an AngularJS route (e.g. the Sprint Taskboard) having set its
        // own title BEFORE the React Kanban root mounts — the exact state after
        // a browser Back into the board. The board's mount-time metadata effect
        // must reset the tab title to the Kanban title rather than leaving the
        // previous route's title stale.
        document.title = "Sprint 2026 - Sprint taskboard - Other Project";

        await renderLoaded();

        expect(document.title).toBe("Kanban - My Project");
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
        const submit = document.querySelector(".e2e-bulk-submit") as HTMLButtonElement;
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
        // NOTE: the empty-guard lives on the BULK path; the "standard" path opens
        // the React create lightbox (F1) instead of this bulk textarea.
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 200);
        });
        const submit = document.querySelector(".e2e-bulk-submit") as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(submit);
        });
        expect(mockBulkCreate).not.toHaveBeenCalled();
        // An empty submit no longer closes the lightbox silently (QA-FUNC-06/07);
        // the lightbox stays open so the user can correct the input.
        expect(document.querySelector(".bulk-subjects")).not.toBeNull();
    });

    it("closes the bulk lightbox without creating when Close is clicked", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        expect(document.querySelector(".bulk-subjects")).not.toBeNull();
        const close = document.querySelector(".e2e-bulk-close") as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(close);
        });
        expect(document.querySelector(".bulk-subjects")).toBeNull();
        expect(mockBulkCreate).not.toHaveBeenCalled();
    });

    // F-KANBAN-BULK-MODAL + F-KANBAN-BULK-CLOSE-LABEL: the bulk-insert lightbox
    // must be an accessible modal dialog (role=dialog, aria-modal, an accessible
    // name wired to its title, focus moved inside on open, and Escape-to-close),
    // and its close control must carry the generic dialog "close" label — not
    // the notification-toast "Close notification" string.
    it("exposes the bulk lightbox as an accessible modal dialog with a correct close label", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        const dialog = document.querySelector(
            ".lightbox-generic-bulk",
        ) as HTMLElement;
        expect(dialog).not.toBeNull();
        // Modal dialog semantics.
        expect(dialog.getAttribute("role")).toBe("dialog");
        expect(dialog.getAttribute("aria-modal")).toBe("true");
        // Accessible name is wired from the dialog title via aria-labelledby.
        const labelledBy = dialog.getAttribute("aria-labelledby");
        expect(labelledBy).toBeTruthy();
        const title = document.querySelector("h2.title") as HTMLElement;
        expect(title).not.toBeNull();
        expect(title.id).toBe(labelledBy);
        expect(title.textContent).toBe("New bulk insert");
        // Focus is moved into the dialog on open (never left on <body>). The hook
        // moves focus on a post-paint setTimeout(0), so poll for it.
        await waitFor(() => {
            expect(dialog.contains(document.activeElement)).toBe(true);
            expect(document.activeElement).not.toBe(document.body);
        });
        // F-KANBAN-BULK-CLOSE-LABEL: the close control is named "close".
        const close = document.querySelector(".e2e-bulk-close") as HTMLButtonElement;
        expect(close.getAttribute("aria-label")).toBe("close");
        expect(close.getAttribute("title")).toBe("close");
        // Escape dismisses the (topmost) dialog.
        await act(async () => {
            fireEvent.keyDown(dialog, { key: "Escape" });
        });
        expect(document.querySelector(".bulk-subjects")).toBeNull();
        expect(mockBulkCreate).not.toHaveBeenCalled();
    });

    // QA-FUNC-06: a failed bulk_create must keep the lightbox OPEN, RETAIN the
    // typed text, and surface an inline error (no unhandled rejection, no data
    // loss). Previously `submitBulk` had no `.catch()` and closed synchronously.
    it("keeps the lightbox open, retains text and shows an error when bulk_create fails", async () => {
        mockBulkCreate.mockRejectedValueOnce(new Error("boom"));
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        const textarea = document.querySelector(
            ".bulk-subjects",
        ) as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, { target: { value: "Story A\nStory B" } });
        });
        await act(async () => {
            fireEvent.click(document.querySelector(".e2e-bulk-submit") as HTMLButtonElement);
        });
        expect(mockBulkCreate).toHaveBeenCalledTimes(1);
        // Lightbox STILL open, text preserved, inline error shown.
        const stillOpen = document.querySelector(
            ".bulk-subjects",
        ) as HTMLTextAreaElement;
        expect(stillOpen).not.toBeNull();
        expect(stillOpen.value).toBe("Story A\nStory B");
        expect(document.querySelector(".bulk-error")).not.toBeNull();
    });

    // The lightbox must close and clear the error on a SUCCESSFUL submit.
    it("closes the lightbox and clears the error on a successful bulk_create", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        await act(async () => {
            fireEvent.change(
                document.querySelector(".bulk-subjects") as HTMLTextAreaElement,
                { target: { value: "Story A" } },
            );
        });
        await act(async () => {
            fireEvent.click(document.querySelector(".e2e-bulk-submit") as HTMLButtonElement);
        });
        expect(document.querySelector(".bulk-subjects")).toBeNull();
        expect(document.querySelector(".bulk-error")).toBeNull();
    });

    // QA-FUNC-04: the enriched lightbox reproduces every region the AngularJS
    // `lightbox-us-bulk.jade` had (title, status selector, top/bottom position
    // radios, placeholder, cols=200). On a no-swimlane board the swimlane
    // selector is absent (its ng-if requires swimlanesList.size).
    it("renders the enriched lightbox regions (title, status, position, textarea)", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        expect(document.querySelector(".title")?.textContent).toBe(
            "New bulk insert",
        );
        const statusSelector = document.querySelector(".bulk-status-selector");
        expect(statusSelector).not.toBeNull();
        expect(statusSelector?.textContent).toContain("Status 100");
        const radios = document.querySelectorAll(
            ".creation-position input[type='radio']",
        ) as NodeListOf<HTMLInputElement>;
        expect(radios.length).toBe(2);
        expect(radios[0].value).toBe("bottom");
        expect(radios[0].checked).toBe(true);
        expect(radios[1].value).toBe("top");
        const textarea = document.querySelector(
            ".bulk-subjects",
        ) as HTMLTextAreaElement;
        expect(textarea.placeholder).toBe("One item per line...");
        expect(textarea.cols).toBe(200);
        expect(
            document.querySelector(".js-submit-button")?.textContent,
        ).toBe("Save");
        // No swimlanes -> no swimlane selector.
        expect(document.querySelector(".swimlane-select")).toBeNull();
    });

    // QA-FUNC-04: in swimlane mode the swimlane selector appears and shows the
    // project default swimlane (pre-selected).
    it("shows the swimlane selector (default pre-selected) in swimlane mode", async () => {
        currentProject = makeProject({ default_swimlane: 50 });
        currentSwimlanes = [
            { id: 50, name: "Backend", statuses: [makeStatus(100, 1)] },
        ];
        currentUserstories = [makeUs({ id: 1, status: 100, swimlane: 50 })];
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        const swimlaneField = document.querySelector(".swimlane-select");
        expect(swimlaneField).not.toBeNull();
        expect(swimlaneField?.textContent).toContain("Backend");
    });

    // QA-FUNC-05: bulk_create must carry the SELECTED swimlane (defaulting to the
    // project default_swimlane) rather than the previously hardcoded null.
    it("passes the default swimlane to bulk_create in swimlane mode (QA-FUNC-05)", async () => {
        currentProject = makeProject({ default_swimlane: 50 });
        currentSwimlanes = [
            { id: 50, name: "Backend", statuses: [makeStatus(100, 1)] },
        ];
        currentUserstories = [makeUs({ id: 1, status: 100, swimlane: 50 })];
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        await act(async () => {
            fireEvent.change(
                document.querySelector(".bulk-subjects") as HTMLTextAreaElement,
                { target: { value: "Story A" } },
            );
        });
        await act(async () => {
            fireEvent.click(
                document.querySelector(".e2e-bulk-submit") as HTMLButtonElement,
            );
        });
        expect(mockBulkCreate).toHaveBeenCalledWith(
            PROJECT_ID,
            100,
            "Story A",
            50,
        );
    });

    // QA-FUNC-07: an empty submit is blocked with a visible REQUIRED message and
    // performs no bulk_create (it previously closed the lightbox silently).
    it("blocks an empty submit with the required message (QA-FUNC-07)", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        await act(async () => {
            fireEvent.click(
                document.querySelector(".e2e-bulk-submit") as HTMLButtonElement,
            );
        });
        expect(mockBulkCreate).not.toHaveBeenCalled();
        expect(document.querySelector(".bulk-error")?.textContent).toBe(
            "This value is required.",
        );
        expect(document.querySelector(".bulk-subjects")).not.toBeNull();
    });

    // QA-FUNC-07: a line >= 200 chars is blocked with the LINEWIDTH message and
    // performs no bulk_create.
    it("blocks a >200-char line with the linewidth message (QA-FUNC-07)", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        await act(async () => {
            fireEvent.change(
                document.querySelector(".bulk-subjects") as HTMLTextAreaElement,
                { target: { value: "x".repeat(200) } },
            );
        });
        await act(async () => {
            fireEvent.click(
                document.querySelector(".e2e-bulk-submit") as HTMLButtonElement,
            );
        });
        expect(mockBulkCreate).not.toHaveBeenCalled();
        expect(document.querySelector(".bulk-error")?.textContent).toBe(
            "One or more lines is perhaps too long. Try to keep under 200 characters.",
        );
    });

    // QA-FUNC-04: changing the status via the selector submits the NEW status.
    it("submits the status chosen in the status selector", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        await act(async () => {
            fireEvent.click(
                document.querySelector(".bulk-status-selector") as HTMLButtonElement,
            );
        });
        const options = document.querySelectorAll(
            ".bulk-status-option",
        ) as NodeListOf<HTMLButtonElement>;
        // Pick the option for status 200 (the other project status).
        const option200 = Array.from(options).find((o) =>
            o.textContent?.includes("Status 200"),
        ) as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(option200);
        });
        await act(async () => {
            fireEvent.change(
                document.querySelector(".bulk-subjects") as HTMLTextAreaElement,
                { target: { value: "Story A" } },
            );
        });
        await act(async () => {
            fireEvent.click(
                document.querySelector(".e2e-bulk-submit") as HTMLButtonElement,
            );
        });
        expect(mockBulkCreate).toHaveBeenCalledWith(
            PROJECT_ID,
            200,
            "Story A",
            null,
        );
    });

    // QA-FUNC-04 "on top": choosing the top radio reorders the created stories
    // ahead of the column's current first story (mirrors moveUsToTop) via
    // bulk_update_kanban_order.
    it("reorders created stories to the top when the top position is chosen", async () => {
        mockBulkCreate.mockImplementationOnce(() =>
            Promise.resolve(mkRes([{ id: 900 }])),
        );
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        const radios = document.querySelectorAll(
            ".creation-position input[type='radio']",
        ) as NodeListOf<HTMLInputElement>;
        await act(async () => {
            fireEvent.click(radios[1]); // "on top"
        });
        await act(async () => {
            fireEvent.change(
                document.querySelector(".bulk-subjects") as HTMLTextAreaElement,
                { target: { value: "Story A" } },
            );
        });
        await act(async () => {
            fireEvent.click(
                document.querySelector(".e2e-bulk-submit") as HTMLButtonElement,
            );
        });
        // bulk_update_kanban_order placed id 900 BEFORE the current first story (id 1).
        const orderCall = mockHttpPost.mock.calls.find(
            (c) => c[0] === "/userstories/bulk_update_kanban_order",
        );
        expect(orderCall).toBeTruthy();
        expect(orderCall?.[1]).toMatchObject({
            project_id: PROJECT_ID,
            status_id: 100,
            before_userstory_id: 1,
            bulk_userstories: [900],
        });
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

    it("[M-05] rolls the board back to the pre-move snapshot and notifies when persistence fails", async () => {
        await renderLoaded();
        const neighbors: DropNeighbors = { previous: 2, next: null };
        // The exact immer-frozen board handed to the child BEFORE the drag; a
        // successful rollback restores this precise reference.
        const stateBefore = mockCaptured.boardProps!.state;
        // Make the single bulk_update_kanban_order POST reject.
        mockHttpPost.mockRejectedValueOnce(new Error("persist failed"));
        await act(async () => {
            await mockCaptured.boardProps?.persist(resolvedFor("100::-1"), neighbors);
        });
        // Board restored to the exact pre-move snapshot (reference equality).
        expect(mockCaptured.boardProps?.state).toBe(stateBefore);
        // Transient move highlight cleared on rollback.
        expect(mockCaptured.boardProps?.movedUs).toEqual([]);
        // Shared error toast surfaced (mirrors `$tgConfirm.notify("error")`).
        expect(document.querySelector(".kanban-notification-error")).not.toBeNull();
    });

    it("[M-05] a failed persist does not reject (no unhandled rejection)", async () => {
        await renderLoaded();
        const neighbors: DropNeighbors = { previous: 2, next: null };
        mockHttpPost.mockRejectedValueOnce(new Error("persist failed"));
        // The drag handler fires-and-forgets persist; it must resolve, not reject.
        await act(async () => {
            await expect(
                mockCaptured.boardProps?.persist(resolvedFor("100::-1"), neighbors),
            ).resolves.toBeUndefined();
        });
    });

    it("exposes a resolveDrop that delegates to resolveKanbanDrop (null over -> null)", async () => {
        await renderLoaded();
        expect(mockCaptured.boardProps?.resolveDrop(dragEnd(1, null))).toBeNull();
    });

    /* ---- multi-select clear after drag (QA-FUNC-01, legacy moveUs L597) ----- */

    it("clears the whole card selection after a (group) drag persists", async () => {
        await renderLoaded();
        // Select cards 1 and 2 (ctrl/meta-click), mirroring `toggleSelectedUs`.
        await act(async () => {
            mockCaptured.boardProps?.onToggleSelect?.(1);
            mockCaptured.boardProps?.onToggleSelect?.(2);
        });
        expect(mockCaptured.boardProps?.selectedUss).toEqual({ 1: true, 2: true });
        // A drop persists — legacy `moveUs` called `cleanSelectedUss()` first
        // line on EVERY drop, so the selection must be empty afterwards.
        const neighbors: DropNeighbors = { previous: 2, next: null };
        await act(async () => {
            await mockCaptured.boardProps?.persist(resolvedFor("100::-1"), neighbors);
        });
        expect(mockCaptured.boardProps?.selectedUss).toEqual({});
    });

    it("clears the selection even when the drag persist FAILS (cleared on every drop)", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onToggleSelect?.(1);
            mockCaptured.boardProps?.onToggleSelect?.(2);
        });
        expect(mockCaptured.boardProps?.selectedUss).toEqual({ 1: true, 2: true });
        // Make the bulk-order POST reject; the board rolls back BUT the selection
        // is still cleared (legacy cleared it before persistence, unconditionally).
        mockHttpPost.mockRejectedValueOnce(new Error("persist failed"));
        const neighbors: DropNeighbors = { previous: 2, next: null };
        await act(async () => {
            await mockCaptured.boardProps?.persist(resolvedFor("100::-1"), neighbors);
        });
        expect(mockCaptured.boardProps?.selectedUss).toEqual({});
    });
});

/* ========================================================================== */
/* Component — move to top (M-13)                                             */
/* ========================================================================== */

// The default board holds ordered cards [1, 2] in status 100 (no swimlane).
// `handleMoveToTop` ports `moveUsToTop` -> `moveUs(null, [us], status, swimlane,
// 0, null, firstUsId)` via the same bulk_update_kanban_order contract as a drag.
describe("KanbanApp — move to top (M-13)", () => {
    it("moves a non-first card to the top with the exact bulk-order payload and highlights it", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickMoveToTop?.(2);
        });
        const call = mockHttpPost.mock.calls.find(
            (c) => c[0] === "/userstories/bulk_update_kanban_order",
        );
        expect(call).toBeDefined();
        // Ported moveUs(null, [2], 100, null, firstId=1): placed BEFORE the
        // current first card (id 1), no swimlane_id for the -1 sentinel.
        expect(call?.[1]).toEqual({
            project_id: PROJECT_ID,
            status_id: 100,
            bulk_userstories: [2],
            before_userstory_id: 1,
        });
        // The moved card is highlighted for the transient window.
        expect(mockCaptured.boardProps?.movedUs).toEqual([2]);
    });

    it("is a no-op for a card already at the top of its column (first-card gating)", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickMoveToTop?.(1);
        });
        // Card 1 is already first -> NO bulk-order request is issued.
        const call = mockHttpPost.mock.calls.find(
            (c) => c[0] === "/userstories/bulk_update_kanban_order",
        );
        expect(call).toBeUndefined();
        expect(mockCaptured.boardProps?.movedUs).toEqual([]);
    });

    it("is a no-op for an unknown card id", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickMoveToTop?.(999999);
        });
        const call = mockHttpPost.mock.calls.find(
            (c) => c[0] === "/userstories/bulk_update_kanban_order",
        );
        expect(call).toBeUndefined();
    });

    it("clears the card selection when moving a card to the top (legacy moveUs path)", async () => {
        await renderLoaded();
        // Select cards 1 and 2, then move card 2 to the top.
        await act(async () => {
            mockCaptured.boardProps?.onToggleSelect?.(1);
            mockCaptured.boardProps?.onToggleSelect?.(2);
        });
        expect(mockCaptured.boardProps?.selectedUss).toEqual({ 1: true, 2: true });
        await act(async () => {
            mockCaptured.boardProps?.onClickMoveToTop?.(2);
        });
        // moveUsToTop -> moveUs cleared the selection first, like the drag path.
        expect(mockCaptured.boardProps?.selectedUss).toEqual({});
    });

    it("rolls the board back to the pre-move snapshot and notifies when the move fails", async () => {
        await renderLoaded();
        // The exact immer-frozen board BEFORE the move; rollback restores it.
        const stateBefore = mockCaptured.boardProps!.state;
        // Make the single bulk_update_kanban_order POST reject.
        mockHttpPost.mockRejectedValueOnce(new Error("move failed"));
        await act(async () => {
            mockCaptured.boardProps?.onClickMoveToTop?.(2);
        });
        // The failure path re-renders once the rejection is handled.
        await waitFor(() =>
            expect(
                document.querySelector(".kanban-notification-error"),
            ).not.toBeNull(),
        );
        // Board restored to the exact pre-move snapshot (reference equality).
        expect(mockCaptured.boardProps?.state).toBe(stateBefore);
        // Transient highlight cleared on rollback.
        expect(mockCaptured.boardProps?.movedUs).toEqual([]);
    });
});

/* ========================================================================== */
/* Component — folded-swimlane drag hover auto-open (M-12)                    */
/* ========================================================================== */

// The Swimlane owns the ~1s hover timer (covered by Swimlane.test.tsx); this
// suite proves the APP wires the callback the real root previously omitted:
// `onRequestOpenSwimlane` must be supplied and must OPEN + persist a folded
// swimlane (port of `mouseoverSwimlane` -> `ctrl.toggleSwimlane`).
describe("KanbanApp — swimlane hover auto-open (M-12)", () => {
    it("supplies onRequestOpenSwimlane to the board", async () => {
        await renderLoaded();
        expect(typeof mockCaptured.boardProps?.onRequestOpenSwimlane).toBe(
            "function",
        );
    });

    it("opens a folded swimlane when the board requests it (unfold + persist)", async () => {
        await renderLoaded();
        // Fold swimlane 50 first (manual toggle), then request-open it.
        await act(async () => {
            mockCaptured.boardProps?.onToggleSwimlane?.(50);
        });
        expect(mockCaptured.boardProps?.foldedSwimlane?.[50]).toBe(true);

        await act(async () => {
            mockCaptured.boardProps?.onRequestOpenSwimlane?.(50);
        });
        expect(mockCaptured.boardProps?.foldedSwimlane?.[50]).toBe(false);
    });

    it("never re-folds an already-open swimlane (open-only, no-op)", async () => {
        await renderLoaded();
        // Swimlane 50 starts open (foldedSwimlane empty) -> request-open is a no-op.
        await act(async () => {
            mockCaptured.boardProps?.onRequestOpenSwimlane?.(50);
        });
        expect(!!mockCaptured.boardProps?.foldedSwimlane?.[50]).toBe(false);
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

    // QA-FUNC-02: archived status columns must load PRE-FOLDED (squished),
    // mirroring the AngularJS `ctrl.initialLoad` watcher (kanban/main.coffee
    // L797-803). Non-archived columns stay unfolded.
    it("pre-folds every archived status column on initial load", async () => {
        const archived = makeStatus(300, 3);
        archived.is_archived = true;
        currentProject = makeProject({
            us_statuses: [makeStatus(100, 1), makeStatus(200, 2), archived],
        });
        await renderLoaded();
        expect(mockCaptured.boardProps?.folds[300]).toBe(true);
        // Non-archived columns are NOT pre-folded.
        expect(mockCaptured.boardProps?.folds[100]).toBeFalsy();
        expect(mockCaptured.boardProps?.folds[200]).toBeFalsy();
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

    // [N-03] Delete now opens the THEMED, localized ConfirmDialog
    // (.lightbox-generic-delete) — the port of `$tgConfirm.askOnDelete(...)` —
    // instead of the browser-native `window.confirm`. `onClickDelete` OPENS the
    // dialog; the DELETE only runs after its confirm (.js-confirm) button.
    it("opens the themed confirm dialog and deletes + reloads on confirm", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickDelete?.(1);
        });
        const dialog = document.querySelector(
            ".lightbox-generic-delete.open",
        ) as HTMLElement | null;
        expect(dialog).not.toBeNull();
        // No DELETE fires until the user confirms.
        expect(mockHttpDelete).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(dialog!.querySelector(".js-confirm") as HTMLElement);
            await Promise.resolve();
        });
        expect(mockHttpDelete).toHaveBeenCalledWith("/userstories/1");
        // The dialog closes after a successful delete.
        await waitFor(() =>
            expect(
                document.querySelector(".lightbox-generic-delete.open"),
            ).toBeNull(),
        );
    });

    it("does not delete when the confirm dialog is cancelled", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickDelete?.(1);
        });
        const dialog = document.querySelector(
            ".lightbox-generic-delete.open",
        ) as HTMLElement | null;
        expect(dialog).not.toBeNull();

        await act(async () => {
            fireEvent.click(dialog!.querySelector(".js-cancel") as HTMLElement);
            await Promise.resolve();
        });
        expect(mockHttpDelete).not.toHaveBeenCalled();
        // Cancel closes the dialog.
        expect(
            document.querySelector(".lightbox-generic-delete.open"),
        ).toBeNull();
    });

    // QA-FUNC-14: a failed DELETE must surface an error notification and SKIP the
    // reload (so the still-present card remains), mirroring the AngularJS
    // `confirm.notify("error")` branch. Previously there was no `.catch()`.
    it("shows an error notification and does NOT reload when delete fails", async () => {
        mockHttpDelete.mockRejectedValueOnce(new Error("boom"));
        await renderLoaded();
        // Baseline: listUserstories calls so far (initial load).
        const callsBefore = mockListUserstories.mock.calls.length;
        await act(async () => {
            mockCaptured.boardProps?.onClickDelete?.(1);
        });
        const dialog = document.querySelector(
            ".lightbox-generic-delete.open",
        ) as HTMLElement | null;
        expect(dialog).not.toBeNull();

        await act(async () => {
            fireEvent.click(dialog!.querySelector(".js-confirm") as HTMLElement);
            await Promise.resolve();
        });
        expect(mockHttpDelete).toHaveBeenCalledWith("/userstories/1");
        // Error banner shown...
        expect(document.querySelector(".kanban-notification-error")).not.toBeNull();
        // ...and NO extra reload was triggered by the failed delete.
        expect(mockListUserstories.mock.calls.length).toBe(callsBefore);
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

/* ========================================================================== */
/* F1 — single ("standard") create opens the React create lightbox            */
/* ========================================================================== */
/*
 * QA finding — create/edit/assign were silent no-ops: the migrated `kanban.jade`
 * removed the Angular `tg-lb-create-edit` generic-form host, so the old
 * `genericform:new` / `genericform:edit` broadcasts reached no receiver. The
 * create/edit/assign flows are now re-owned by the React `UserStoryEditLightbox`
 * (persisting via the frozen `bulk_create` + `PATCH` endpoints), so these specs
 * assert the React form opens/persists rather than an Angular broadcast.
 */
describe("KanbanApp — standard create (F1)", () => {
    it("opens the React create lightbox seeded with the clicked column and does NOT open the bulk lightbox", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("standard", 100);
        });
        // The React create form is revealed (the `open` class drives the SCSS
        // reveal), titled "New user story", seeded with the clicked column status.
        const lb = document.querySelector(".lightbox-create-edit.open");
        expect(lb).not.toBeNull();
        expect(lb?.querySelector(".title")?.textContent).toContain("New user story");
        expect(lb?.querySelector(".status-dropdown .status-text")?.textContent).toBe(
            "Status 100",
        );
        // A standard create must NOT open the bulk textarea, and must not create
        // (no atomic POST /userstories, no bulk_create) until the form is submitted.
        expect(document.querySelector(".bulk-subjects")).toBeNull();
        expect(mockBulkCreate).not.toHaveBeenCalled();
        expect(
            mockHttpPost.mock.calls.some((c) => c[0] === "/userstories"),
        ).toBe(false);
    });

    it("persists a new story ATOMICALLY via a single POST /userstories on the clicked column when the form is submitted (#5)", async () => {
        mockHttpPost.mockImplementation((...args: readonly unknown[]) =>
            args[0] === "/userstories"
                ? Promise.resolve(mkRes({ id: 555, version: 1 }))
                : Promise.resolve(mkRes([])),
        );
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("standard", 100);
        });
        const lb = document.querySelector(".lightbox-create-edit.open") as HTMLElement;
        const subject = lb.querySelector('input[name="subject"]') as HTMLInputElement;
        fireEvent.change(subject, { target: { value: "Brand new story" } });
        await act(async () => {
            fireEvent.submit(lb.querySelector("form") as HTMLFormElement);
            await Promise.resolve();
        });
        // [#5] ATOMIC create: the WHOLE story is persisted in ONE POST /userstories
        // (standard serializer field names), NEVER a bulk_create + follow-up PATCH.
        // bulkCreate is no longer used by the single-story create path.
        expect(mockBulkCreate).not.toHaveBeenCalled();
        const createCall = mockHttpPost.mock.calls.find(
            (c) => c[0] === "/userstories",
        );
        expect(createCall).toBeTruthy();
        expect(createCall?.[1]).toMatchObject({
            project: PROJECT_ID,
            subject: "Brand new story",
            status: 100,
            swimlane: null,
        });
        // No follow-up PATCH — a subject-only create makes exactly one write, so a
        // rejected create can never leave an orphan story.
        expect(mockHttpPatch).not.toHaveBeenCalled();
        // Form closes on success.
        await waitFor(() =>
            expect(document.querySelector(".lightbox-create-edit.open")).toBeNull(),
        );
    });

    // [#5] A REJECTED atomic create must persist NOTHING (no orphan story): the
    // single POST /userstories is the ONLY write, there is NO follow-up PATCH, and
    // the lightbox stays OPEN surfacing the error. The old bulk_create + PATCH flow
    // would have already created the row before the PATCH, so a PATCH failure left
    // an orphan; the atomic create leaves nothing behind on failure.
    it("a failed create makes a single POST with NO follow-up PATCH and keeps the lightbox open (#5 orphan-prevention)", async () => {
        mockHttpPost.mockImplementation((...args: readonly unknown[]) =>
            args[0] === "/userstories"
                ? Promise.reject(new Error("invalid assignee"))
                : Promise.resolve(mkRes([])),
        );
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("standard", 100);
        });
        const lb = document.querySelector(".lightbox-create-edit.open") as HTMLElement;
        fireEvent.change(lb.querySelector('input[name="subject"]') as HTMLInputElement, {
            target: { value: "Doomed story" },
        });
        await act(async () => {
            fireEvent.submit(lb.querySelector("form") as HTMLFormElement);
            await Promise.resolve();
        });
        // Exactly one create attempt, and crucially NO follow-up PATCH.
        expect(
            mockHttpPost.mock.calls.filter((c) => c[0] === "/userstories").length,
        ).toBe(1);
        expect(mockBulkCreate).not.toHaveBeenCalled();
        expect(mockHttpPatch).not.toHaveBeenCalled();
        // The lightbox stays OPEN so the user can correct the input.
        await waitFor(() =>
            expect(
                document.querySelector(".lightbox-create-edit.open"),
            ).not.toBeNull(),
        );
    });

    it("still opens the React bulk lightbox for a bulk create", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("bulk", 100);
        });
        expect(document.querySelector(".bulk-subjects")).not.toBeNull();
    });

    it("standard create opens the form regardless of AngularJS (no dependency, no throw)", async () => {
        await renderLoaded();
        expect(() => {
            act(() => {
                mockCaptured.boardProps?.onAddUs?.("standard", 100);
            });
        }).not.toThrow();
        // The React form opens with no AngularJS present, and no create fires yet
        // (neither the atomic POST /userstories nor bulk_create).
        expect(document.querySelector(".lightbox-create-edit.open")).not.toBeNull();
        expect(mockBulkCreate).not.toHaveBeenCalled();
        expect(
            mockHttpPost.mock.calls.some((c) => c[0] === "/userstories"),
        ).toBe(false);
    });
});

/* ========================================================================== */
/* F3 — edit / assignee board callbacks open the React edit lightbox          */
/* ========================================================================== */

describe("KanbanApp — edit & assignee callbacks (F3)", () => {
    it("onClickEdit opens the React edit form seeded from the clicked story", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickEdit?.(1);
        });
        const lb = document.querySelector(".lightbox-create-edit.open") as HTMLElement;
        expect(lb).not.toBeNull();
        expect(lb.querySelector(".title")?.textContent).toContain("Edit user story");
        // Seeded from the clicked story (id 1, subject "A story").
        expect((lb.querySelector('input[name="subject"]') as HTMLInputElement).value).toBe(
            "A story",
        );
    });

    it("onClickAssignedTo opens the dedicated select-user picker for the clicked story (KAN-03)", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickAssignedTo?.(1);
        });
        // [KAN-03] The card's "Assign to" affordance opens the dedicated
        // Select-assigned-user picker (ports `tg-lb-select-user`) — a search +
        // avatar member list — NOT the full story-edit form.
        const picker = document.querySelector(
            ".lightbox-select-user.open",
        ) as HTMLElement;
        expect(picker).not.toBeNull();
        expect(picker.querySelector(".title")?.textContent).toContain(
            "Select assigned user",
        );
        // The full edit form is NOT opened by the quick-assign action.
        expect(
            document.querySelector(".lightbox-create-edit.open"),
        ).toBeNull();
    });

    it("does not open the form for an unknown story id", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickEdit?.(999999);
            mockCaptured.boardProps?.onClickAssignedTo?.(999999);
        });
        // Neither the edit form nor the [KAN-03] select-user picker opens for an
        // unknown id (both handlers return early).
        expect(document.querySelector(".lightbox-create-edit.open")).toBeNull();
        expect(document.querySelector(".lightbox-select-user.open")).toBeNull();
    });

    it("edit persists via PATCH userstories/{id} with the story version when submitted", async () => {
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickEdit?.(1);
        });
        const lb = document.querySelector(".lightbox-create-edit.open") as HTMLElement;
        const subject = lb.querySelector('input[name="subject"]') as HTMLInputElement;
        fireEvent.change(subject, { target: { value: "Edited subject" } });
        await act(async () => {
            fireEvent.submit(lb.querySelector("form") as HTMLFormElement);
            await Promise.resolve();
        });
        expect(mockHttpPatch).toHaveBeenCalledWith(
            "/userstories/1",
            expect.objectContaining({ subject: "Edited subject", status: 100 }),
        );
        await waitFor(() =>
            expect(document.querySelector(".lightbox-create-edit.open")).toBeNull(),
        );
    });

    it("edit / assign are inert (no throw) and open the React form regardless of AngularJS", async () => {
        await renderLoaded();
        expect(() => {
            act(() => {
                mockCaptured.boardProps?.onClickEdit?.(1);
            });
        }).not.toThrow();
        expect(document.querySelector(".lightbox-create-edit.open")).not.toBeNull();
        // D-1: opening the edit form kicks off an async description hydration
        // (fetchDetail → GET /userstories/{id}). Flush that pending promise chain
        // inside act() so the resulting state update settles here and is not
        // reported as an "update not wrapped in act(...)" warning.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    });
});

/* ========================================================================== */
/* M-10 — user-story form persistence: extended PATCH + attachment side-effects */
/* ========================================================================== */

describe("KanbanApp — user-story form persistence (M-10)", () => {
    it("create persists ALL secondary fields in a single ATOMIC POST /userstories (no follow-up PATCH) and uploads chosen files (#5)", async () => {
        mockHttpPost.mockImplementation((...args: readonly unknown[]) =>
            args[0] === "/userstories"
                ? Promise.resolve(mkRes({ id: 555, version: 1 }))
                : Promise.resolve(mkRes([])),
        );
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("standard", 100);
        });
        const lb = document.querySelector(".lightbox-create-edit.open") as HTMLElement;
        fireEvent.change(lb.querySelector('input[name="subject"]') as HTMLInputElement, {
            target: { value: "Rich US" },
        });
        fireEvent.change(lb.querySelector("textarea.description") as HTMLTextAreaElement, {
            target: { value: "the description" },
        });
        fireEvent.click(lb.querySelector(".btn-icon.team-requirement") as HTMLElement);
        const file = new File(["data"], "attach.png", { type: "image/png" });
        fireEvent.change(lb.querySelector('input[type="file"]') as HTMLInputElement, {
            target: { files: [file] },
        });
        await act(async () => {
            fireEvent.submit(lb.querySelector("form") as HTMLFormElement);
        });

        // [#5] The atomic create carries subject/status/swimlane AND the extended
        // generic-form field set (description, team_requirement, tags, ...) in ONE
        // request — bulk_create is not used and there is NO follow-up PATCH.
        expect(mockBulkCreate).not.toHaveBeenCalled();
        await waitFor(() => {
            const createCall = mockHttpPost.mock.calls.find(
                (c) => c[0] === "/userstories",
            );
            expect(createCall).toBeTruthy();
            expect(createCall?.[1]).toMatchObject({
                project: PROJECT_ID,
                subject: "Rich US",
                status: 100,
                swimlane: null,
                description: "the description",
                team_requirement: true,
                tags: [],
            });
        });
        expect(mockHttpPatch).not.toHaveBeenCalled();
        // The chosen file is uploaded as an attachment of the CREATED story via a
        // multipart POST to the frozen `/userstories/attachments` endpoint.
        await waitFor(() =>
            expect(mockHttpPost).toHaveBeenCalledWith(
                "/userstories/attachments",
                expect.any(FormData),
            ),
        );
        const attachCall = mockHttpPost.mock.calls.find(
            (c) => c[0] === "/userstories/attachments",
        ) as unknown[] | undefined;
        const fd = attachCall?.[1] as FormData;
        expect(fd.get("object_id")).toBe("555");
        expect(fd.get("project")).toBe(String(PROJECT_ID));
        expect((fd.get("attached_file") as File).name).toBe("attach.png");
    });

    it("a subject-only create makes exactly ONE atomic POST /userstories (no PATCH) and uploads nothing (#5)", async () => {
        mockHttpPost.mockImplementation((...args: readonly unknown[]) =>
            args[0] === "/userstories"
                ? Promise.resolve(mkRes({ id: 556, version: 1 }))
                : Promise.resolve(mkRes([])),
        );
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onAddUs?.("standard", 100);
        });
        const lb = document.querySelector(".lightbox-create-edit.open") as HTMLElement;
        fireEvent.change(lb.querySelector('input[name="subject"]') as HTMLInputElement, {
            target: { value: "Just a subject" },
        });
        await act(async () => {
            fireEvent.submit(lb.querySelector("form") as HTMLFormElement);
        });
        await waitFor(() =>
            expect(document.querySelector(".lightbox-create-edit.open")).toBeNull(),
        );
        // [#5] Exactly ONE atomic create — no bulk_create, no follow-up PATCH — so a
        // rejected create can never leave an orphan story behind.
        expect(mockBulkCreate).not.toHaveBeenCalled();
        expect(
            mockHttpPost.mock.calls.filter((c) => c[0] === "/userstories").length,
        ).toBe(1);
        expect(mockHttpPatch).not.toHaveBeenCalled();
        expect(
            mockHttpPost.mock.calls.some((c) => c[0] === "/userstories/attachments"),
        ).toBe(false);
    });

    it("edit persists the extended field set, deletes removed attachments, and uploads new ones", async () => {
        currentUserstories = [
            makeUs({
                id: 1,
                status: 100,
                kanban_order: 0,
                version: 9,
                attachments: [{ id: 55, name: "old.pdf" }],
                total_attachments: 1,
            } as Partial<UserStoryModel>),
        ];
        mockListUserstories.mockImplementation(() =>
            Promise.resolve(mkRes(currentUserstories)),
        );
        await renderLoaded();
        await act(async () => {
            mockCaptured.boardProps?.onClickEdit?.(1);
        });
        const lb = document.querySelector(".lightbox-create-edit.open") as HTMLElement;
        // The existing attachment is shown (seeded from the model — no GET).
        expect(lb.querySelectorAll(".single-attachment").length).toBe(1);
        // Delete the existing attachment (queues id 55).
        fireEvent.click(lb.querySelector(".attachment-delete") as HTMLElement);
        // Add a new file.
        const file = new File(["data"], "fresh.png", { type: "image/png" });
        fireEvent.change(lb.querySelector('input[type="file"]') as HTMLInputElement, {
            target: { files: [file] },
        });
        fireEvent.change(lb.querySelector("textarea.description") as HTMLTextAreaElement, {
            target: { value: "updated body" },
        });
        await act(async () => {
            fireEvent.submit(lb.querySelector("form") as HTMLFormElement);
        });

        // The edit PATCH carries the extended field set + optimistic version.
        await waitFor(() =>
            expect(mockHttpPatch).toHaveBeenCalledWith(
                "/userstories/1",
                expect.objectContaining({
                    description: "updated body",
                    version: 9,
                }),
            ),
        );
        // The removed attachment is deleted through the frozen endpoint.
        await waitFor(() =>
            expect(mockHttpDelete).toHaveBeenCalledWith("/userstories/attachments/55"),
        );
        // The new file is uploaded against the same story.
        const attachCall = mockHttpPost.mock.calls.find(
            (c) => c[0] === "/userstories/attachments",
        ) as unknown[] | undefined;
        expect(attachCall).toBeTruthy();
        const fd = attachCall?.[1] as FormData;
        expect(fd.get("object_id")).toBe("1");
        expect((fd.get("attached_file") as File).name).toBe("fresh.png");
    });
});

/* ========================================================================== */
/* F4 — blocked (403) / archived (451) responses map to permission-denied     */
/* ========================================================================== */

describe("KanbanApp — blocked / archived project (F4)", () => {
    it("renders permission-denied (not a load error) on a 403 project response", async () => {
        mockHttpGet.mockRejectedValue(
            new HttpError(403, "Forbidden", {}, `/projects/${PROJECT_ID}`),
        );
        render(<KanbanApp projectId={PROJECT_ID} projectSlug="my-project" />);
        await waitFor(() =>
            expect(document.querySelector(".permission-denied")).not.toBeNull(),
        );
        expect(document.querySelector(".kanban-load-error")).toBeNull();
        // QA-FUNC-10: a visible message must accompany the 403 permission-denied.
        expect(
            document.querySelector(".permission-denied .kanban-permission-denied-message"),
        ).not.toBeNull();
        expect(mockCaptured.boardProps).toBeNull();
    });

    it("renders permission-denied (not a load error) on a 451 project response", async () => {
        mockHttpGet.mockRejectedValue(
            new HttpError(451, "Unavailable For Legal Reasons", {}, `/projects/${PROJECT_ID}`),
        );
        render(<KanbanApp projectId={PROJECT_ID} projectSlug="my-project" />);
        await waitFor(() =>
            expect(document.querySelector(".permission-denied")).not.toBeNull(),
        );
        expect(document.querySelector(".kanban-load-error")).toBeNull();
        // QA-FUNC-10: a visible message must accompany the 451 permission-denied.
        expect(
            document.querySelector(".permission-denied .kanban-permission-denied-message"),
        ).not.toBeNull();
    });

    it("still surfaces the generic load error for a non-permission HttpError (500)", async () => {
        mockHttpGet.mockRejectedValue(
            new HttpError(500, "Server Error", {}, `/projects/${PROJECT_ID}`),
        );
        render(<KanbanApp projectId={PROJECT_ID} projectSlug="my-project" />);
        await waitFor(() =>
            expect(document.querySelector(".kanban-load-error")).not.toBeNull(),
        );
        expect(document.querySelector(".permission-denied")).toBeNull();
    });
});

/* ========================================================================== */
/* F2 — sidebar filter panel (5 categories, status excluded)                  */
/* ========================================================================== */

describe("KanbanApp — sidebar filters (F2)", () => {
    function seedFilters(): void {
        currentFiltersData = {
            // `statuses` is intentionally present in the payload to PROVE it is
            // NOT surfaced as a Kanban sidebar category (columns are statuses).
            statuses: [{ id: 100, name: "New", color: "#ffffff", count: 3 }],
            tags: [{ name: "urgent", color: "#ff0000", count: 2 }],
            assigned_users: [{ id: 9, full_name: "Alice", count: 1 }],
            roles: [{ id: 3, name: "Developer", count: 4 }],
            owners: [{ id: 1, full_name: "Bob", count: 5 }],
            epics: [{ id: 7, ref: 12, subject: "Epic A", count: 1 }],
        };
    }

    async function openFilterPanel(): Promise<void> {
        const filterBtn = document.querySelector(".btn-filter") as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(filterBtn);
        });
        // KAN-04: categories are now the collapsible tg-filter accordion —
        // one `<li data-type>` per category under `.filters-cats`.
        await waitFor(() =>
            expect(
                document.querySelectorAll(".filters-cats li[data-type]").length,
            ).toBe(5),
        );
    }

    /**
     * KAN-04: the tg-filter accordion is collapsed by default, so an option is
     * reached by first expanding its category (`.filters-cat-single`) and then
     * clicking the revealed `.single-filter`.
     */
    async function expandAndClickOption(dataType: string): Promise<void> {
        const catHeader = document.querySelector(
            `li[data-type="${dataType}"] .filters-cat-single`,
        ) as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(catHeader);
        });
        const option = document.querySelector(
            `li[data-type="${dataType}"] .filter-list .single-filter`,
        ) as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(option);
        });
    }

    it("renders the five whitelisted categories and OMITS status", async () => {
        seedFilters();
        await renderLoaded();
        await openFilterPanel();

        expect(document.querySelector(".kanban-filter")).not.toBeNull();
        const dataTypes = Array.from(
            document.querySelectorAll(".filters-cats li[data-type]"),
        ).map((el) => el.getAttribute("data-type"));
        expect(dataTypes).toEqual([
            "tags",
            "assigned_users",
            "role",
            "owner",
            "epic",
        ]);
        // Status must never be offered as a Kanban sidebar filter.
        expect(document.querySelector('[data-type="status"]')).toBeNull();
    });

    it("selecting a tag reloads user stories with the grouped query param", async () => {
        seedFilters();
        await renderLoaded();
        await openFilterPanel();

        const before = mockListUserstories.mock.calls.length;
        await expandAndClickOption("tags");

        await waitFor(() =>
            expect(mockListUserstories.mock.calls.length).toBeGreaterThan(before),
        );
        expect(mockListUserstories).toHaveBeenCalledWith(
            PROJECT_ID,
            expect.objectContaining({ tags: "urgent" }),
        );
        // The applied-filter chip is shown (KAN-04 tg-filter `single-applied-filter`).
        expect(
            document.querySelector(".filters-applied .single-applied-filter"),
        ).not.toBeNull();
    });

    it("removing an applied tag reloads WITHOUT the query param", async () => {
        seedFilters();
        await renderLoaded();
        await openFilterPanel();

        await expandAndClickOption("tags");
        await waitFor(() =>
            expect(document.querySelector(".single-applied-filter")).not.toBeNull(),
        );

        // KAN-04: removal is via the chip's × glyph (`.remove-filter` button).
        const removeBtn = document.querySelector(
            ".single-applied-filter .remove-filter",
        ) as HTMLButtonElement;
        const beforeRemove = mockListUserstories.mock.calls.length;
        await act(async () => {
            fireEvent.click(removeBtn);
        });

        await waitFor(() =>
            expect(document.querySelector(".single-applied-filter")).toBeNull(),
        );
        // A reload was issued and it carried NO `tags` param.
        expect(mockListUserstories.mock.calls.length).toBeGreaterThan(beforeRemove);
        const lastCall =
            mockListUserstories.mock.calls[mockListUserstories.mock.calls.length - 1];
        expect(lastCall[1]).not.toHaveProperty("tags");
    });
});

/* ========================================================================== */
/* QA-FUNC-03 / QA-FUNC-09 — fold + filter persistence across reloads         */
/* ========================================================================== */

describe("KanbanApp — fold + filter persistence (QA-FUNC-03, QA-FUNC-09)", () => {
    // --- QA-FUNC-03: column + swimlane fold modes ---

    it("restores persisted column fold modes on load", async () => {
        saveColumnFolds(PROJECT_ID, { 100: true, 200: false });

        await renderLoaded();

        expect(mockCaptured.boardProps?.folds).toMatchObject({
            100: true,
            200: false,
        });
    });

    it("restores persisted swimlane fold modes on load", async () => {
        saveSwimlaneFolds(PROJECT_ID, { 10: true, 20: false });

        await renderLoaded();

        expect(mockCaptured.boardProps?.foldedSwimlane).toMatchObject({
            10: true,
            20: false,
        });
    });

    it("forces archived columns folded even when persisted unfolded (QA-FUNC-02 precedence)", async () => {
        // An archived status persisted as UNFOLDED must still render folded on a
        // fresh load: the archived override is applied ON TOP of restored modes.
        currentProject = makeProject({
            us_statuses: [
                makeStatus(100, 1),
                { ...makeStatus(300, 3), is_archived: true },
            ],
        });
        saveColumnFolds(PROJECT_ID, { 100: false, 300: false });

        await renderLoaded();

        expect(mockCaptured.boardProps?.folds[300]).toBe(true); // archived forced
        expect(mockCaptured.boardProps?.folds[100]).toBe(false); // restored as-is
    });

    it("persists a column fold toggle so it survives a reload", async () => {
        await renderLoaded();
        const status = makeStatus(100, 1);

        await act(async () => {
            mockCaptured.boardProps?.onFoldStatus?.(status);
        });

        expect(loadColumnFolds(PROJECT_ID)).toMatchObject({ 100: true });
    });

    it("persists a swimlane fold toggle so it survives a reload", async () => {
        await renderLoaded();

        await act(async () => {
            mockCaptured.boardProps?.onToggleSwimlane?.(10);
        });

        expect(loadSwimlaneFolds(PROJECT_ID)).toMatchObject({ 10: true });
    });

    // --- QA-FUNC-09: sidebar filters + search query ---

    it("writes the search query to storage on change (dropped again on load)", async () => {
        // The search handler still WRITES `q` to storage (harmless, mirrors the
        // legacy `storeFilters` which stored the whole filter object). The raw
        // entry therefore carries the query...
        await renderLoaded();
        const search = document.querySelector(
            'input[type="search"]',
        ) as HTMLInputElement;

        await act(async () => {
            fireEvent.change(search, { target: { value: "login" } });
        });

        const raw = window.localStorage.getItem(`kanban-filters.${PROJECT_ID}`);
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw as string).q).toBe("login");
        // ...but `loadKanbanFilters` strips it on read (legacy `delete data.q`),
        // so the query is never restored.
        expect(loadKanbanFilters(PROJECT_ID)?.q).toBe("");
    });

    it("does NOT restore a persisted search query on load (legacy delete data.q): box empty, full board", async () => {
        // Legacy parity (controllerMixins.coffee `getFilters` L131): the search
        // query is dropped on load, so the reloaded board shows the FULL set with
        // an empty search box — this is exactly the QA finding (Issue #1a) that a
        // restored `q` incorrectly narrowed the board on reload.
        saveKanbanFilters(PROJECT_ID, { q: "login", selected: [] });

        await renderLoaded();

        const search = document.querySelector(
            'input[type="search"]',
        ) as HTMLInputElement;
        expect(search.value).toBe("");
        // The dropped query must NOT feed the first userstories request.
        expect(mockListUserstories).not.toHaveBeenCalledWith(
            PROJECT_ID,
            expect.objectContaining({ q: "login" }),
        );
    });

    it("restores persisted selected filters and applies them to the first fetch", async () => {
        // The QA finding's canonical case: an "assigned to" filter (Carol) must
        // survive a reload and re-filter the board on the first fetch.
        saveKanbanFilters(PROJECT_ID, {
            q: "",
            selected: [
                { id: "9", name: "Carol", dataType: "assigned_users" },
            ],
        });

        await renderLoaded();

        expect(mockListUserstories).toHaveBeenCalledWith(
            PROJECT_ID,
            expect.objectContaining({ assigned_users: "9" }),
        );
    });

    it("persists an added sidebar filter selection", async () => {
        currentFiltersData = {
            tags: [{ name: "urgent", color: "#ff0000", count: 2 }],
        };
        await renderLoaded();

        const filterBtn = document.querySelector(
            ".btn-filter",
        ) as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(filterBtn);
        });
        await waitFor(() =>
            expect(
                document.querySelectorAll(".filters-cats li[data-type]").length,
            ).toBeGreaterThan(0),
        );

        // KAN-04: expand the tags accordion category, then click the option.
        const catHeader = document.querySelector(
            'li[data-type="tags"] .filters-cat-single',
        ) as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(catHeader);
        });
        const tagOption = document.querySelector(
            'li[data-type="tags"] .filter-list .single-filter',
        ) as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(tagOption);
        });

        const persisted = loadKanbanFilters<{
            id: string;
            name: string;
            dataType: string;
        }>(PROJECT_ID);
        expect(persisted?.selected).toEqual([
            expect.objectContaining({ dataType: "tags", name: "urgent" }),
        ]);
    });
});

/* ========================================================================== */
/* F-KANBAN-ARCHIVED-NO-LOAD — archived column lazy-loads its stories on unfold */
/* ========================================================================== */

describe("KanbanApp — archived column lazy load (F-KANBAN-ARCHIVED-NO-LOAD)", () => {
    const ARCHIVED_ID = 300;

    // A project with one live column (100) and one ARCHIVED column (300).
    function installArchivedProject(): void {
        currentProject = makeProject({
            us_statuses: [
                makeStatus(100, 1),
                { ...makeStatus(ARCHIVED_ID, 3), is_archived: true },
            ],
        });
    }

    // Route `listUserstories`: the per-status ARCHIVED fetch (params.status ===
    // ARCHIVED_ID) returns the archived story; every other (base) fetch returns
    // the live story. This distinguishes the two request kinds the fix issues.
    function installArchivedRouting(
        base: UserStoryModel[],
        archived: UserStoryModel[],
    ): void {
        mockListUserstories.mockImplementation((...args: readonly unknown[]) => {
            const params = (args[1] ?? {}) as Record<string, unknown>;
            if (params.status === ARCHIVED_ID) {
                return Promise.resolve(mkRes(archived));
            }
            return Promise.resolve(mkRes(base));
        });
    }

    function archivedStatus(): Status {
        return { ...makeStatus(ARCHIVED_ID, 3), is_archived: true };
    }

    it("does not fetch archived stories on initial load; the archived column starts empty and folded", async () => {
        installArchivedProject();
        installArchivedRouting(
            [makeUs({ id: 1, status: 100 })],
            [makeUs({ id: 99, status: ARCHIVED_ID })],
        );
        await renderLoaded();
        // The archived column is forced folded and its stories are NOT loaded.
        expect(mockCaptured.boardProps?.folds[ARCHIVED_ID]).toBe(true);
        expect(
            mockCaptured.boardProps?.state.usByStatus[String(ARCHIVED_ID)] ?? [],
        ).toEqual([]);
        const archivedCalls = mockListUserstories.mock.calls.filter(
            (call) => (call[1] as Record<string, unknown>).status === ARCHIVED_ID,
        );
        expect(archivedCalls.length).toBe(0);
    });

    it("keeps the base board request's status__is_archived:false filter unchanged", async () => {
        installArchivedProject();
        installArchivedRouting(
            [makeUs({ id: 1, status: 100 })],
            [makeUs({ id: 99, status: ARCHIVED_ID })],
        );
        await renderLoaded();
        const baseCall = mockListUserstories.mock.calls.find(
            (call) => (call[1] as Record<string, unknown>).status === undefined,
        );
        expect(baseCall).toBeTruthy();
        expect(
            (baseCall![1] as Record<string, unknown>).status__is_archived,
        ).toBe(false);
    });

    it("fetches (without the archived filter) and merges archived stories when the column is unfolded", async () => {
        installArchivedProject();
        installArchivedRouting(
            [makeUs({ id: 1, status: 100 })],
            [makeUs({ id: 99, status: ARCHIVED_ID, subject: "Archived story" })],
        );
        await renderLoaded();

        await act(async () => {
            mockCaptured.boardProps?.onFoldStatus?.(archivedStatus());
        });

        // A per-status archived request was issued, scoped to the status id and
        // WITHOUT the base `status__is_archived:false` filter.
        await waitFor(() => {
            const archivedCalls = mockListUserstories.mock.calls.filter(
                (call) =>
                    (call[1] as Record<string, unknown>).status === ARCHIVED_ID,
            );
            expect(archivedCalls.length).toBe(1);
        });
        const archivedCall = mockListUserstories.mock.calls.find(
            (call) => (call[1] as Record<string, unknown>).status === ARCHIVED_ID,
        );
        expect(
            (archivedCall![1] as Record<string, unknown>).status__is_archived,
        ).toBeUndefined();

        // The archived story now populates the archived column; the live column
        // is preserved (base + archived merge).
        await waitFor(() =>
            expect(
                mockCaptured.boardProps?.state.usByStatus[String(ARCHIVED_ID)],
            ).toEqual([99]),
        );
        expect(mockCaptured.boardProps?.state.usByStatus["100"]).toEqual([1]);
    });

    it("drops the archived stories from the board when the column is re-folded", async () => {
        installArchivedProject();
        installArchivedRouting(
            [makeUs({ id: 1, status: 100 })],
            [makeUs({ id: 99, status: ARCHIVED_ID })],
        );
        await renderLoaded();

        // Unfold -> archived stories load.
        await act(async () => {
            mockCaptured.boardProps?.onFoldStatus?.(archivedStatus());
        });
        await waitFor(() =>
            expect(
                mockCaptured.boardProps?.state.usByStatus[String(ARCHIVED_ID)],
            ).toEqual([99]),
        );

        // Fold again -> archived stories are removed from the board.
        await act(async () => {
            mockCaptured.boardProps?.onFoldStatus?.(archivedStatus());
        });
        await waitFor(() =>
            expect(
                mockCaptured.boardProps?.state.usByStatus[String(ARCHIVED_ID)] ?? [],
            ).toEqual([]),
        );
    });
});

/* ========================================================================== */
/* F-C — unmount guard: a late-resolving load must not continue post-unmount  */
/* ========================================================================== */

describe("KanbanApp — unmount safety (F-C)", () => {
    it("aborts the load (no userstories fetch, no board) if unmounted before the project resolves", async () => {
        let resolveProject: () => void = () => undefined;
        mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
            const path = String(args[0]);
            if (path.startsWith("/projects/")) {
                return new Promise((resolve) => {
                    resolveProject = () => resolve(mkRes(currentProject));
                });
            }
            if (path === "/swimlanes") {
                return Promise.resolve(mkRes(currentSwimlanes));
            }
            if (path === "/userstories/filters_data") {
                return Promise.resolve(mkRes(currentFiltersData));
            }
            return Promise.resolve(mkRes({}));
        });

        const { unmount } = render(
            <KanbanApp projectId={PROJECT_ID} projectSlug="my-project" />,
        );
        // Unmount while the project request is still pending.
        unmount();
        // Resolve the project AFTER unmount; the aliveRef guard must short-circuit.
        await act(async () => {
            resolveProject();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockListUserstories).not.toHaveBeenCalled();
        expect(mockCaptured.boardProps).toBeNull();
    });
});

