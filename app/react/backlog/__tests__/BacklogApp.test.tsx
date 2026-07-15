/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the React `BacklogApp` composition root
 * (app/react/backlog/BacklogApp.tsx).
 *
 * Runs in the browserless jsdom environment (jest.config.js). EVERY `../shared/**`
 * adapter is mocked so no real `fetch`/WebSocket is touched, and the presentational
 * child components are stubbed (props captured) so the test drives BacklogApp's own
 * control flow directly. The REAL `useBacklogState` hook is used (it is a pure
 * reducer with its own dedicated spec), so state transitions are exercised
 * end-to-end.
 *
 * Mandated scenarios (per the file's validation checklist), plus a broad battery
 * covering every mutation handler, the drag-and-drop resolve/persist path, the
 * filters / search / toggle handlers, the WebSocket callbacks, and the render
 * branches (empty states, forecasting, filter panel, permission / load-error):
 *  (a) projectId = NaN            -> NO network call and NO WebSocket connect/subscribe
 *  (b) is_backlog_activated:false -> renders permission-denied, does NOT load the backlog
 *  (c) happy path                 -> loads project/stats/sprints/userstories; renders
 *                                    `.backlog`, `.backlog-table`, and the SprintList
 *  (d) onChangeStatus             -> PATCHes `{ status, version }`, then reloads stats
 *  (e) broadcastToAngular         -> a no-op when `window.angular` is undefined
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DragEndEvent } from "@dnd-kit/core";

import { BacklogApp } from "../BacklogApp";
import type { Project, ProjectStats, Sprint, UserStory } from "../types";
import type { BacklogTableProps } from "../BacklogTable";
import type { BurndownProps } from "../Burndown";
import type { SprintListProps } from "../SprintList";
import type { SprintEditLightboxProps } from "../SprintEditLightbox";
import type { BulkUserStoriesLightboxProps } from "../BulkUserStoriesLightbox";
import type {
    DndProviderProps,
    NormalizedDragEnd,
    ResolvedDrop,
    DropNeighbors,
} from "../../shared/dnd/DndProvider";

import { httpGet, httpPatch, httpDelete, HttpError } from "../../shared/api/httpClient";
import { list as listMilestones } from "../../shared/api/milestones";
import {
    filtersData,
    bulkUpdateBacklogOrder,
    bulkUpdateMilestone,
} from "../../shared/api/userstories";
import { createEventsClient } from "../../shared/events/websocket";
import { createBacklogPersister, isDragEnabled } from "../../shared/dnd/DndProvider";

/* -------------------------------------------------------------------------- */
/* Module mocks — ALL of ../shared/** plus the presentational children.        */
/* Variables referenced inside a jest.mock factory MUST be `mock`-prefixed     */
/* (ts-jest hoists the factory above the imports).                             */
/* -------------------------------------------------------------------------- */

// Shared, reusable events-client stub so the test can assert connect/subscribe.
const mockEventsClient = {
    connect: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    disconnect: jest.fn(),
};

// A single stable backlog persister so the DnD `persist` path can be asserted.
const mockPersister = jest.fn((..._args: readonly unknown[]) =>
    Promise.resolve({ data: [] as UserStory[], status: 200, headers: new Headers() }),
);

// Captures the props BacklogApp drills into each (mocked) child so the test can
// invoke the contract callbacks (actions, lightbox handlers, DnD resolve/persist)
// without a real child render.
interface Captured {
    backlogTableProps: BacklogTableProps | null;
    dndProps: DndProviderProps | null;
    sprintListProps: SprintListProps | null;
    sprintEditProps: SprintEditLightboxProps | null;
    bulkProps: BulkUserStoriesLightboxProps | null;
    burndownProps: BurndownProps | null;
}
const mockCaptured: Captured = {
    backlogTableProps: null,
    dndProps: null,
    sprintListProps: null,
    sprintEditProps: null,
    bulkProps: null,
    burndownProps: null,
};

jest.mock("../../shared/api/httpClient", () => {
    // A real HttpError class so the SUT's `err instanceof HttpError` checks and
    // `.status` reads behave exactly as in production.
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

jest.mock("../../shared/api/userstories", () => ({
    __esModule: true,
    filtersData: jest.fn(() =>
        Promise.resolve({ data: {}, status: 200, headers: new Headers() }),
    ),
    bulkUpdateBacklogOrder: jest.fn(() =>
        Promise.resolve({ data: [], status: 200, headers: new Headers() }),
    ),
    bulkUpdateMilestone: jest.fn(() =>
        Promise.resolve({ data: undefined, status: 204, headers: new Headers() }),
    ),
    bulkCreate: jest.fn(() =>
        Promise.resolve({ data: [], status: 200, headers: new Headers() }),
    ),
}));

jest.mock("../../shared/api/milestones", () => ({
    __esModule: true,
    list: jest.fn(() => Promise.resolve({ milestones: [], open: 0, closed: 0 })),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    moveUserStoriesToSprint: jest.fn(() =>
        Promise.resolve({ data: undefined, status: 204, headers: new Headers() }),
    ),
}));

jest.mock("../../shared/events/websocket", () => ({
    __esModule: true,
    createEventsClient: jest.fn(() => mockEventsClient),
}));

jest.mock("../../shared/dnd/DndProvider", () => {
    const react = jest.requireActual("react") as typeof import("react");
    return {
        __esModule: true,
        // Pass-through: capture props AND render children so `section.backlog` +
        // `sidebar` appear, exactly as the real (fragment-rendering) provider does.
        DndProvider: (props: DndProviderProps) => {
            mockCaptured.dndProps = props;
            return react.createElement(react.Fragment, null, props.children);
        },
        isDragEnabled: jest.fn(() => true),
        createBacklogPersister: jest.fn(() => mockPersister),
    };
});

jest.mock("../Burndown", () => {
    const react = jest.requireActual("react") as typeof import("react");
    return {
        __esModule: true,
        Burndown: (props: BurndownProps) => {
            mockCaptured.burndownProps = props;
            return react.createElement("div", {
                className: "backlog-summary",
                "data-testid": "burndown",
            });
        },
    };
});

jest.mock("../BacklogTable", () => {
    const react = jest.requireActual("react") as typeof import("react");
    return {
        __esModule: true,
        BacklogTable: (props: BacklogTableProps) => {
            mockCaptured.backlogTableProps = props;
            return react.createElement("div", { "data-testid": "backlog-table-mock" });
        },
    };
});

jest.mock("../SprintList", () => {
    const react = jest.requireActual("react") as typeof import("react");
    return {
        __esModule: true,
        SprintList: (props: SprintListProps) => {
            mockCaptured.sprintListProps = props;
            return react.createElement("div", { "data-testid": "sprint-list" });
        },
    };
});

jest.mock("../SprintEditLightbox", () => ({
    __esModule: true,
    SprintEditLightbox: (props: SprintEditLightboxProps) => {
        mockCaptured.sprintEditProps = props;
        return null;
    },
}));

jest.mock("../BulkUserStoriesLightbox", () => ({
    __esModule: true,
    BulkUserStoriesLightbox: (props: BulkUserStoriesLightboxProps) => {
        mockCaptured.bulkProps = props;
        return null;
    },
}));

/* -------------------------------------------------------------------------- */
/* Typed handles to the mocked functions                                       */
/* -------------------------------------------------------------------------- */

// The http adapters are generic (`<T>(...) => Promise<HttpResponse<T>>`); cast to
// a permissive async-mock type so `mockImplementation` stays ergonomic without
// leaking `any`.
type AsyncMock = jest.MockedFunction<(...args: readonly unknown[]) => Promise<unknown>>;
const mockHttpGet = httpGet as unknown as AsyncMock;
const mockHttpPatch = httpPatch as unknown as AsyncMock;
const mockHttpDelete = httpDelete as unknown as AsyncMock;
const mockListMilestones = listMilestones as unknown as AsyncMock;
const mockFiltersData = filtersData as unknown as AsyncMock;
const mockBulkUpdateBacklogOrder = bulkUpdateBacklogOrder as unknown as AsyncMock;
const mockBulkUpdateMilestone = bulkUpdateMilestone as unknown as AsyncMock;
const mockCreateEventsClient = jest.mocked(createEventsClient);
const mockCreateBacklogPersister = createBacklogPersister as unknown as jest.Mock;
const mockIsDragEnabled = isDragEnabled as unknown as jest.Mock;

/* -------------------------------------------------------------------------- */
/* Test data factories (shapes mirror the sibling specs)                       */
/* -------------------------------------------------------------------------- */

const PROJECT_ID = 5;

function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: PROJECT_ID,
        slug: "my-project",
        name: "My Project",
        my_permissions: ["add_us", "add_milestone", "modify_us", "delete_milestone"],
        roles: [],
        points: [],
        us_statuses: [],
        is_backlog_activated: true,
        is_kanban_activated: true,
        default_us_status: 1,
        total_milestones: 2,
        i_am_admin: true,
        ...overrides,
    };
}

function makeStats(overrides: Partial<ProjectStats> = {}): ProjectStats {
    return {
        total_points: 100,
        defined_points: 100,
        closed_points: 50,
        assigned_points: 0,
        speed: 10,
        total_milestones: 2,
        milestones: [],
        ...overrides,
    };
}

function makeSprint(overrides: Partial<Sprint> = {}): Sprint {
    return {
        id: 10,
        name: "Sprint 1",
        slug: "sprint-1",
        project: PROJECT_ID,
        estimated_start: "2021-01-01",
        estimated_finish: "2021-01-15",
        closed: false,
        closed_points: 3,
        total_points: 6,
        user_stories: [],
        ...overrides,
    };
}

function makeUs(overrides: Partial<UserStory> = {}): UserStory {
    return {
        id: 1000,
        ref: 1,
        subject: "A story",
        project: PROJECT_ID,
        status: 100,
        milestone: null,
        points: { "1": 11 },
        total_points: 1,
        backlog_order: 1,
        sprint_order: 1,
        assigned_to: null,
        is_blocked: false,
        is_closed: false,
        tags: null,
        epics: null,
        due_date: null,
        version: 1,
        ...overrides,
    };
}

function mkRes<T>(data: T, headers: Record<string, string> = {}): {
    data: T;
    status: number;
    headers: Headers;
} {
    return { data, status: 200, headers: new Headers(headers) };
}

function dragEnd(activeId: number, overId: number | string | null): NormalizedDragEnd {
    // resolveDrop only reads activeId/overId; the raw dnd-kit event is unused here.
    return { activeId, overId, event: {} as unknown as DragEndEvent };
}

/* -------------------------------------------------------------------------- */
/* Per-test wiring (mutable fixtures the http mock reads lazily)               */
/* -------------------------------------------------------------------------- */

let currentProject: Project;
let currentUserstories: UserStory[];
let currentUsHeaders: Record<string, string>;
let currentStats: ProjectStats;
let currentOpenSprints: Sprint[];
let currentClosedSprints: Sprint[];
let currentFiltersData: Record<string, unknown>;

/** Route `httpGet` by path, mirroring the endpoints BacklogApp calls. */
function installHappyHttp(): void {
    mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
        const path = String(args[0]);
        if (path.includes("/stats")) {
            return Promise.resolve(mkRes(currentStats));
        }
        if (path === `projects/${PROJECT_ID}`) {
            return Promise.resolve(mkRes(currentProject));
        }
        if (path === "userstories") {
            return Promise.resolve(mkRes(currentUserstories, currentUsHeaders));
        }
        return Promise.resolve(mkRes({}));
    });
    mockHttpPatch.mockImplementation((...args: readonly unknown[]) => {
        // Echo a patched user story so `patchUserStory` has data to reconcile.
        const body = (args[1] ?? {}) as Partial<UserStory>;
        return Promise.resolve(mkRes(makeUs({ ...body, id: 1000 })));
    });
    mockHttpDelete.mockImplementation(() => Promise.resolve(mkRes(undefined)));
    mockListMilestones.mockImplementation((...args: readonly unknown[]) => {
        const filters = (args[1] ?? {}) as { closed?: boolean };
        if (filters.closed) {
            return Promise.resolve({
                milestones: currentClosedSprints,
                open: currentOpenSprints.length,
                closed: currentClosedSprints.length,
            });
        }
        return Promise.resolve({
            milestones: currentOpenSprints,
            open: currentOpenSprints.length,
            closed: currentClosedSprints.length,
        });
    });
    mockFiltersData.mockImplementation(() => Promise.resolve(mkRes(currentFiltersData)));
    mockPersister.mockImplementation(() =>
        Promise.resolve({ data: [] as UserStory[], status: 200, headers: new Headers() }),
    );
    mockBulkUpdateBacklogOrder.mockImplementation(() =>
        Promise.resolve(mkRes([] as UserStory[])),
    );
    mockBulkUpdateMilestone.mockImplementation(() =>
        Promise.resolve({ data: undefined, status: 204, headers: new Headers() }),
    );
}

beforeEach(() => {
    // jest.config.js sets clearMocks:true (call history reset). Re-install the
    // implementations (clearMocks does NOT reset those) and the default fixtures.
    currentProject = makeProject();
    currentUserstories = [makeUs()];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "1" };
    currentStats = makeStats();
    currentOpenSprints = [makeSprint()]; // past dates -> NOT the current sprint
    currentClosedSprints = [];
    currentFiltersData = {};
    mockCaptured.backlogTableProps = null;
    mockCaptured.dndProps = null;
    mockCaptured.sprintListProps = null;
    mockCaptured.sprintEditProps = null;
    mockCaptured.bulkProps = null;
    mockCaptured.burndownProps = null;
    installHappyHttp();
    // `clearMocks:true` resets call history but NOT implementations, so a test
    // that flips the DnD permission gate to `false` would otherwise leak into
    // later tests. Re-assert the default (DnD permitted) before every test.
    mockIsDragEnabled.mockReturnValue(true);
    // Ensure no Angular injector is present unless a test adds one.
    delete (window as unknown as { angular?: unknown }).angular;
    try {
        window.localStorage.clear();
    } catch {
        /* jsdom always provides localStorage; guard for safety */
    }
});

/** Render the app and wait until the loaded backlog shell is on screen. */
async function renderApp(projectId: number = PROJECT_ID): Promise<{
    container: HTMLElement;
    unmount: () => void;
}> {
    const utils = render(
        <BacklogApp projectId={projectId} projectSlug="my-project" />,
    );
    await waitFor(() => expect(utils.container.querySelector(".backlog")).not.toBeNull());
    return { container: utils.container, unmount: utils.unmount };
}

/** Count `httpGet` calls whose path matches a predicate. */
function countGet(pred: (path: string) => boolean): number {
    return mockHttpGet.mock.calls.filter((c) => pred(String(c[0]))).length;
}

/* ========================================================================== */
/* (a) Transient-NaN guard: no network, no WebSocket                          */
/* ========================================================================== */

test("does not touch the network or WebSocket while projectId is NaN", async () => {
    render(<BacklogApp projectId={Number.NaN} projectSlug="my-project" />);

    await act(async () => {
        await Promise.resolve();
    });

    expect(mockHttpGet).not.toHaveBeenCalled();
    expect(mockHttpPatch).not.toHaveBeenCalled();
    expect(mockListMilestones).not.toHaveBeenCalled();
    expect(mockFiltersData).not.toHaveBeenCalled();
    expect(mockCreateEventsClient).not.toHaveBeenCalled();
    expect(mockEventsClient.connect).not.toHaveBeenCalled();
    expect(mockEventsClient.subscribe).not.toHaveBeenCalled();
});

test("renders the neutral loading shell (no crash) while projectId is NaN", () => {
    const { container } = render(
        <BacklogApp projectId={Number.NaN} projectSlug="my-project" />,
    );
    const main = container.querySelector("main.main.scrum");
    expect(main).not.toBeNull();
    // No board content while the id is unresolved.
    expect(container.querySelector(".backlog-table")).toBeNull();
});

/* ========================================================================== */
/* (b) Permission denied when the backlog module is disabled                   */
/* ========================================================================== */

test("renders permission-denied and skips the backlog load when is_backlog_activated is false", async () => {
    currentProject = makeProject({ is_backlog_activated: false });

    const { container } = render(
        <BacklogApp projectId={PROJECT_ID} projectSlug="my-project" />,
    );

    await waitFor(() =>
        expect(container.querySelector(".permission-denied")).not.toBeNull(),
    );

    expect(mockHttpGet).toHaveBeenCalledWith(`projects/${PROJECT_ID}`);
    expect(countGet((p) => p.includes("/stats"))).toBe(0);
    expect(countGet((p) => p === "userstories")).toBe(0);
    expect(mockListMilestones).not.toHaveBeenCalled();
});

test("renders permission-denied on a 403 project response", async () => {
    mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
        if (String(args[0]) === `projects/${PROJECT_ID}`) {
            return Promise.reject(new HttpError(403, "Forbidden", null, "projects/5"));
        }
        return Promise.resolve(mkRes({}));
    });

    const { container } = render(
        <BacklogApp projectId={PROJECT_ID} projectSlug="my-project" />,
    );

    await waitFor(() =>
        expect(container.querySelector(".permission-denied")).not.toBeNull(),
    );
    expect(countGet((p) => p.includes("/stats"))).toBe(0);
});

test("does not crash and renders permission-denied on a 451 (unavailable-for-legal-reasons) project response", async () => {
    // A blocked / archived project answers 451; BacklogApp treats 403 and 451
    // identically (BacklogApp.tsx: `err.status === 403 || err.status === 451`),
    // so the screen must gracefully degrade to the permission-denied path with
    // no downstream backlog load and no thrown error.
    mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
        if (String(args[0]) === `projects/${PROJECT_ID}`) {
            return Promise.reject(
                new HttpError(451, "Unavailable For Legal Reasons", null, "projects/5"),
            );
        }
        return Promise.resolve(mkRes({}));
    });

    const { container } = render(
        <BacklogApp projectId={PROJECT_ID} projectSlug="my-project" />,
    );

    await waitFor(() =>
        expect(container.querySelector(".permission-denied")).not.toBeNull(),
    );
    // No board and no downstream fetches after the gate.
    expect(container.querySelector(".backlog-table")).toBeNull();
    expect(countGet((p) => p.includes("/stats"))).toBe(0);
    expect(countGet((p) => p === "userstories")).toBe(0);
    expect(mockListMilestones).not.toHaveBeenCalled();
});

test("renders the load-error shell on a non-permission project failure", async () => {
    mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
        if (String(args[0]) === `projects/${PROJECT_ID}`) {
            return Promise.reject(new HttpError(500, "Server Error", null, "projects/5"));
        }
        return Promise.resolve(mkRes({}));
    });
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const { container } = render(
        <BacklogApp projectId={PROJECT_ID} projectSlug="my-project" />,
    );

    await waitFor(() =>
        expect(container.querySelector(".error-load-data")).not.toBeNull(),
    );
    expect(container.querySelector(".error-load-data")?.textContent).toContain(
        "could not be loaded",
    );
    expect(countGet((p) => p === "userstories")).toBe(0);
    errSpy.mockRestore();
});

/* ========================================================================== */
/* (c) Happy path: loads data and renders the shell + all header controls      */
/* ========================================================================== */

test("loads project/stats/sprints/userstories and renders the backlog shell", async () => {
    const { container } = await renderApp();

    expect(container.querySelector(".backlog-table")).not.toBeNull();
    expect(screen.getByTestId("sprint-list")).toBeInTheDocument();
    expect(screen.getByTestId("burndown")).toBeInTheDocument();

    // All four data sources were consulted.
    expect(mockHttpGet).toHaveBeenCalledWith(`projects/${PROJECT_ID}`);
    expect(countGet((p) => p.includes("/stats"))).toBeGreaterThan(0);
    expect(countGet((p) => p === "userstories")).toBeGreaterThan(0);
    expect(mockListMilestones).toHaveBeenCalledWith(PROJECT_ID, { closed: false });
    expect(mockFiltersData).toHaveBeenCalled();

    // The shared events client was connected and subscribed (single session).
    expect(mockCreateEventsClient).toHaveBeenCalledTimes(1);
    expect(mockEventsClient.connect).toHaveBeenCalledTimes(1);
    expect(mockEventsClient.subscribe).toHaveBeenCalledWith(
        `changes.project.${PROJECT_ID}.userstories`,
        expect.any(Function),
    );
    expect(mockEventsClient.subscribe).toHaveBeenCalledWith(
        `changes.project.${PROJECT_ID}.milestones`,
        expect.any(Function),
        { selfNotification: true },
    );
});

test("renders the header controls: add, bulk, filters button, search, move-to-latest, forecasting", async () => {
    const { container } = await renderApp();

    // addnewus.jade (add_us permission present).
    expect(container.querySelector(".new-us .btn-small")).not.toBeNull();
    expect(container.querySelector(".new-us .btn-icon")).not.toBeNull();
    // Filters toggle + search.
    expect(container.querySelector("#show-filters-button")).not.toBeNull();
    expect(container.querySelector("input.tg-input-search")).not.toBeNull();
    // No current sprint (past dates) -> move-to-latest button.
    expect(container.querySelector("#move-to-latest-sprint")).not.toBeNull();
    expect(container.querySelector("#move-to-current-sprint")).toBeNull();
    // stats.speed > 0 and displayVelocity off -> the (inactive) forecasting button.
    expect(container.querySelector(".velocity-forecasting-btn")).not.toBeNull();
    // Stories present -> the show-tags control renders and the empty states are hidden.
    expect(container.querySelector("#show-tags")).not.toBeNull();
    expect(container.querySelector(".empty-large.hidden")).not.toBeNull();
    expect(container.querySelector(".empty-backlog.hidden")).not.toBeNull();
    // The board section is NOT hidden (has stories).
    const board = container.querySelector("section.backlog-table");
    expect(board?.classList.contains("hidden")).toBe(false);
});

test("passes the correct contract props into BacklogTable and SprintList", async () => {
    await renderApp();
    const bt = mockCaptured.backlogTableProps;
    expect(bt).not.toBeNull();
    expect(bt?.project.id).toBe(PROJECT_ID);
    expect(bt?.dragEnabled).toBe(true);
    expect(bt?.userstories.length).toBe(1);
    expect(typeof bt?.actions.onChangeStatus).toBe("function");

    const sl = mockCaptured.sprintListProps;
    expect(sl).not.toBeNull();
    expect(sl?.openSprints.length).toBe(1);
    expect(sl?.closedSprintsVisible).toBe(false);
});

test("passes dragEnabled=false into BacklogTable when the viewer lacks modify_us", async () => {
    // `dragEnabled` mirrors `isDragEnabled(project)`; a read-only viewer (no
    // `modify_us`, or an archived project) must NOT be able to drag. The DnD
    // gate is mocked, so drive the false branch through it while also modelling
    // a permission-poor project for realism.
    mockIsDragEnabled.mockReturnValue(false);
    currentProject = makeProject({ my_permissions: ["view_us"] });

    await renderApp();

    // The gate was consulted with the loaded project.
    expect(mockIsDragEnabled).toHaveBeenCalledWith(
        expect.objectContaining({ id: PROJECT_ID }),
    );
    // ...and the board received the disabled flag.
    expect(mockCaptured.backlogTableProps).not.toBeNull();
    expect(mockCaptured.backlogTableProps?.dragEnabled).toBe(false);
});

/* ========================================================================== */
/* (d) onChangeStatus PATCHes { status, version } then reloads stats           */
/* ========================================================================== */

test("onChangeStatus PATCHes { status, version } and reloads project stats", async () => {
    await renderApp();
    const props = mockCaptured.backlogTableProps;
    expect(props).not.toBeNull();

    const statsBefore = countGet((p) => p.includes("/stats"));

    await act(async () => {
        props?.actions.onChangeStatus(makeUs({ id: 1000, version: 3 }), 101);
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(mockHttpPatch).toHaveBeenCalledWith("userstories/1000", {
            status: 101,
            version: 3,
        }),
    );
    await waitFor(() =>
        expect(countGet((p) => p.includes("/stats"))).toBeGreaterThan(statsBefore),
    );
});

test("onChangeStatus reloads the backlog on a 409 version conflict", async () => {
    await renderApp();
    mockHttpPatch.mockImplementation(() =>
        Promise.reject(new HttpError(409, "Conflict", null, "userstories/1000")),
    );
    const usBefore = countGet((p) => p === "userstories");

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onChangeStatus(makeUs({ id: 1000 }), 55);
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore),
    );
});

test("onChangePoints PATCHes merged { points, version } and reloads stats", async () => {
    await renderApp();
    const statsBefore = countGet((p) => p.includes("/stats"));

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onChangePoints(
            makeUs({ id: 1000, version: 2, points: { "1": 11 } }),
            2,
            22,
        );
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(mockHttpPatch).toHaveBeenCalledWith("userstories/1000", {
            points: { "1": 11, "2": 22 },
            version: 2,
        }),
    );
    await waitFor(() =>
        expect(countGet((p) => p.includes("/stats"))).toBeGreaterThan(statsBefore),
    );
});

/* ========================================================================== */
/* (e) broadcastToAngular is a no-op when window.angular is undefined          */
/* ========================================================================== */

test("edit action does not throw when window.angular is undefined", async () => {
    await renderApp();
    const props = mockCaptured.backlogTableProps;
    expect(props).not.toBeNull();

    expect(() => {
        act(() => {
            props?.actions.onEditUserStory(makeUs({ id: 7 }));
        });
    }).not.toThrow();

    expect(mockHttpPatch).not.toHaveBeenCalled();
});

test("edit action broadcasts through the Angular injector when present", async () => {
    await renderApp();
    const broadcast = jest.fn();
    const applyAsync = jest.fn();
    (window as unknown as { angular?: unknown }).angular = {
        element: () => ({
            injector: () => ({
                get: () => ({ $broadcast: broadcast, $applyAsync: applyAsync }),
            }),
        }),
    };

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onEditUserStory(makeUs({ id: 7 }));
    });

    expect(broadcast).toHaveBeenCalledWith(
        "genericform:edit",
        expect.objectContaining({ objType: "us" }),
    );
    expect(applyAsync).toHaveBeenCalled();
});

/* ========================================================================== */
/* Delete user story: confirm + DELETE + reload; restore on failure           */
/* ========================================================================== */

test("onDeleteUserStory confirms, DELETEs, and reloads stats + sprints", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    await renderApp();
    const sprintsBefore = mockListMilestones.mock.calls.length;

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onDeleteUserStory(makeUs({ id: 1000 }));
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(mockHttpDelete).toHaveBeenCalledWith("userstories/1000"),
    );
    await waitFor(() =>
        expect(mockListMilestones.mock.calls.length).toBeGreaterThan(sprintsBefore),
    );
    confirmSpy.mockRestore();
});

test("onDeleteUserStory is a no-op when the confirm dialog is dismissed", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
    await renderApp();

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onDeleteUserStory(makeUs({ id: 1000 }));
        await Promise.resolve();
    });

    expect(mockHttpDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
});

test("onDeleteUserStory restores the story when the DELETE fails", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderApp();
    mockHttpDelete.mockImplementation(() =>
        Promise.reject(new HttpError(500, "Server Error", null, "userstories/1000")),
    );

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onDeleteUserStory(makeUs({ id: 1000 }));
        await Promise.resolve();
    });

    // After the rejection the optimistic removal is rolled back -> the story is
    // present again in the table props.
    await waitFor(() =>
        expect(
            mockCaptured.backlogTableProps?.userstories.some((u) => u.id === 1000),
        ).toBe(true),
    );
    confirmSpy.mockRestore();
    errSpy.mockRestore();
});

test("onMoveToTop reorders via bulkUpdateBacklogOrder(project, null, null, nextUs, [id])", async () => {
    await renderApp();

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onMoveToTop(makeUs({ id: 2000 }));
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(mockBulkUpdateBacklogOrder).toHaveBeenCalledWith(
            PROJECT_ID,
            null,
            null,
            1000,
            [2000],
        ),
    );
});

/* ========================================================================== */
/* Add user story (standard / bulk) + lightboxes                              */
/* ========================================================================== */

test("clicking Add broadcasts a standard create and does NOT open the bulk lightbox", async () => {
    const { container } = await renderApp();

    // F-M2: install an Angular injector spy BEFORE the click so the standard
    // "Add" path is asserted at the bridge level. `broadcastToAngular` reads
    // `window.angular` at call time (see the edit-broadcast test above), and
    // beforeEach() deletes it, so this stays local to this test.
    const broadcast = jest.fn();
    const applyAsync = jest.fn();
    (window as unknown as { angular?: unknown }).angular = {
        element: () => ({
            injector: () => ({
                get: () => ({ $broadcast: broadcast, $applyAsync: applyAsync }),
            }),
        }),
    };

    await act(async () => {
        fireEvent.click(container.querySelector(".new-us .btn-small") as HTMLElement);
    });

    // Assert the broadcast NAME + payload — not merely that the React bulk
    // lightbox stayed closed. A mutation renaming "genericform:new" (or routing
    // "standard" into the bulk path) would leave `bulkProps.open === false`
    // and thus survive the old assertion; it now fails here.
    expect(broadcast).toHaveBeenCalledWith(
        "genericform:new",
        expect.objectContaining({ objType: "us" }),
    );
    expect(applyAsync).toHaveBeenCalled();
    expect(mockCaptured.bulkProps?.open).toBe(false);
});

test("clicking the bulk button opens the BulkUserStoriesLightbox", async () => {
    const { container } = await renderApp();

    await act(async () => {
        fireEvent.click(container.querySelector(".new-us .btn-icon") as HTMLElement);
    });

    await waitFor(() => expect(mockCaptured.bulkProps?.open).toBe(true));
    expect(mockCaptured.bulkProps?.defaultStatusId).toBe(1);
});

test("onBulkCreated flags the new stories, reloads, and reorders to the top", async () => {
    await renderApp();
    const usBefore = countGet((p) => p === "userstories");

    await act(async () => {
        await mockCaptured.bulkProps?.onCreated([makeUs({ id: 3000 })], "top");
    });

    // Bulk lightbox closed, backlog reloaded, and the "top" reorder issued.
    await waitFor(() => expect(mockCaptured.bulkProps?.open).toBe(false));
    expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore);
    await waitFor(() =>
        expect(mockBulkUpdateBacklogOrder).toHaveBeenCalledWith(
            PROJECT_ID,
            null,
            null,
            1000,
            [3000],
        ),
    );
});

test("onBulkCreated with position 'bottom' reloads without a top reorder", async () => {
    await renderApp();

    await act(async () => {
        await mockCaptured.bulkProps?.onCreated([makeUs({ id: 3001 })], "bottom");
    });

    await waitFor(() => expect(mockCaptured.bulkProps?.open).toBe(false));
    expect(mockBulkUpdateBacklogOrder).not.toHaveBeenCalled();
});

/* ========================================================================== */
/* Sprint lightbox: add (date defaults) / edit (canDelete) / changed          */
/* ========================================================================== */

test("addNewSprint seeds the create lightbox with last-finish and +2 weeks", async () => {
    await renderApp();

    await act(async () => {
        mockCaptured.sprintListProps?.onAddNewSprint();
    });

    await waitFor(() => expect(mockCaptured.sprintEditProps?.open).toBe(true));
    const p = mockCaptured.sprintEditProps;
    expect(p?.mode).toBe("create");
    expect(p?.initialValues.estimated_start).toBe("2021-01-15");
    expect(p?.initialValues.estimated_finish).toBe("2021-01-29");
    expect(p?.lastSprintName).toBe("Sprint 1");
    expect(p?.canDelete).toBe(false);
});

test("onEditSprint opens edit mode with canDelete from delete_milestone", async () => {
    await renderApp();

    await act(async () => {
        mockCaptured.sprintListProps?.onEditSprint(
            makeSprint({ id: 42, name: "Sprint X" }),
        );
    });

    await waitFor(() => expect(mockCaptured.sprintEditProps?.open).toBe(true));
    const p = mockCaptured.sprintEditProps;
    expect(p?.mode).toBe("edit");
    expect(p?.sprint?.id).toBe(42);
    expect(p?.initialValues.name).toBe("Sprint X");
    expect(p?.canDelete).toBe(true);
});

test("onEditSprint sets canDelete=false without the delete_milestone permission", async () => {
    currentProject = makeProject({ my_permissions: ["add_us", "add_milestone", "modify_us"] });
    await renderApp();

    await act(async () => {
        mockCaptured.sprintListProps?.onEditSprint(makeSprint({ id: 43 }));
    });

    await waitFor(() => expect(mockCaptured.sprintEditProps?.open).toBe(true));
    expect(mockCaptured.sprintEditProps?.canDelete).toBe(false);
});

test("onChanged closes the sprint lightbox and reloads open + closed sprints + stats", async () => {
    await renderApp();

    // Open it first so the close is observable.
    await act(async () => {
        mockCaptured.sprintListProps?.onAddNewSprint();
    });
    await waitFor(() => expect(mockCaptured.sprintEditProps?.open).toBe(true));

    const statsBefore = countGet((p) => p.includes("/stats"));

    await act(async () => {
        await mockCaptured.sprintEditProps?.onChanged();
    });

    await waitFor(() => expect(mockCaptured.sprintEditProps?.open).toBe(false));
    expect(mockListMilestones).toHaveBeenCalledWith(PROJECT_ID, { closed: true });
    expect(countGet((p) => p.includes("/stats"))).toBeGreaterThan(statsBefore);
});

test("closing the sprint / bulk lightboxes flips their open flag back to false", async () => {
    const { container } = await renderApp();

    // Open the sprint create lightbox and the bulk lightbox.
    await act(async () => {
        mockCaptured.sprintListProps?.onAddNewSprint();
        fireEvent.click(container.querySelector(".new-us .btn-icon") as HTMLElement);
    });
    await waitFor(() => expect(mockCaptured.sprintEditProps?.open).toBe(true));
    await waitFor(() => expect(mockCaptured.bulkProps?.open).toBe(true));

    // Their onClose handlers close them.
    await act(async () => {
        mockCaptured.sprintEditProps?.onClose();
        mockCaptured.bulkProps?.onClose();
    });

    await waitFor(() => expect(mockCaptured.sprintEditProps?.open).toBe(false));
    await waitFor(() => expect(mockCaptured.bulkProps?.open).toBe(false));
});

/* ========================================================================== */
/* Filters / search / toggles                                                 */
/* ========================================================================== */

test("toggling filters reveals the filter panel and expands the manager", async () => {
    currentFiltersData = {
        statuses: [{ id: 1, name: "New", color: "#ffcc00", count: 2 }],
        tags: [{ name: "urgent", color: "#f00", count: 1 }],
    };
    const { container } = await renderApp();

    // Manager starts expanded (no active filters).
    expect(container.querySelector(".backlog-manager.expanded")).not.toBeNull();
    expect(container.querySelector("#backlog-filter")).toBeNull();

    await act(async () => {
        fireEvent.click(container.querySelector("#show-filters-button") as HTMLElement);
    });

    await waitFor(() =>
        expect(container.querySelector("#backlog-filter")).not.toBeNull(),
    );
    // The Status + Tags categories were built from the filters payload.
    expect(container.querySelectorAll(".filter-category").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".backlog-manager.expanded")).toBeNull();
});

test("selecting a filter reloads the backlog with the query param and shows the count", async () => {
    currentFiltersData = {
        statuses: [{ id: 7, name: "In progress", color: "#00f", count: 3 }],
    };
    const { container } = await renderApp();

    await act(async () => {
        fireEvent.click(container.querySelector("#show-filters-button") as HTMLElement);
    });
    await waitFor(() => expect(container.querySelector("#backlog-filter")).not.toBeNull());

    await act(async () => {
        fireEvent.click(container.querySelector(".filter-name") as HTMLElement);
    });

    // The reload carried `status=7`, and the selected-filter badge appears.
    await waitFor(() =>
        expect(
            mockHttpGet.mock.calls.some(
                (c) =>
                    String(c[0]) === "userstories" &&
                    (c[1] as Record<string, unknown>)?.status === "7",
            ),
        ).toBe(true),
    );
    await waitFor(() =>
        expect(container.querySelector(".selected-filters")).not.toBeNull(),
    );
});

test("removing a selected filter clears it and reloads without the param", async () => {
    currentFiltersData = {
        statuses: [{ id: 7, name: "In progress", color: "#00f", count: 3 }],
    };
    const { container } = await renderApp();

    await act(async () => {
        fireEvent.click(container.querySelector("#show-filters-button") as HTMLElement);
    });
    await waitFor(() => expect(container.querySelector("#backlog-filter")).not.toBeNull());

    // Add, then remove via the applied-filter chip.
    await act(async () => {
        fireEvent.click(container.querySelector(".filter-name") as HTMLElement);
    });
    await waitFor(() =>
        expect(container.querySelector(".filters-applied .filter-applied")).not.toBeNull(),
    );

    await act(async () => {
        fireEvent.click(
            container.querySelector(".filters-applied .filter-applied") as HTMLElement,
        );
    });

    await waitFor(() =>
        expect(container.querySelector(".filters-applied")).toBeNull(),
    );
});

test("typing in the search box debounces a reset reload carrying q", async () => {
    const { container } = await renderApp();
    const input = container.querySelector("input.tg-input-search") as HTMLInputElement;

    await act(async () => {
        fireEvent.change(input, { target: { value: "widget" } });
    });

    // Controlled value updates immediately.
    expect(input.value).toBe("widget");

    // The debounced (real-timer) reload fires within waitFor's window.
    await waitFor(
        () =>
            expect(
                mockHttpGet.mock.calls.some(
                    (c) =>
                        String(c[0]) === "userstories" &&
                        (c[1] as Record<string, unknown>)?.q === "widget",
                ),
            ).toBe(true),
        { timeout: 2000 },
    );
});

test("show-tags toggle flips the checkbox and persists the preference", async () => {
    const { container } = await renderApp();
    const checkbox = container.querySelector("#show-tags-input") as HTMLInputElement;
    // The hook defaults `showTags` to true, so the control starts checked.
    expect(checkbox.checked).toBe(true);

    await act(async () => {
        fireEvent.click(checkbox);
    });

    await waitFor(() =>
        expect(
            (container.querySelector("#show-tags-input") as HTMLInputElement).checked,
        ).toBe(false),
    );
    expect(window.localStorage.getItem(`showTags-${PROJECT_ID}`)).toBe("false");
});

test("restores the persisted show-tags preference on load", async () => {
    // Persisted OFF while the hook default is ON -> the load path must flip it.
    window.localStorage.setItem(`showTags-${PROJECT_ID}`, "false");
    const { container } = await renderApp();

    await waitFor(() =>
        expect(
            (container.querySelector("#show-tags-input") as HTMLInputElement).checked,
        ).toBe(false),
    );
});

test("velocity/forecasting toggle reveals the add-sprint affordance", async () => {
    const { container } = await renderApp();
    // Inactive forecasting button present (speed>0, displayVelocity off).
    const btn = container.querySelector(".velocity-forecasting-btn") as HTMLElement;
    expect(btn).not.toBeNull();

    await act(async () => {
        fireEvent.click(btn);
    });

    // Now the forecasting add-sprint row appears and the active button variant shows.
    await waitFor(() =>
        expect(container.querySelector(".forecasting-add-sprint")).not.toBeNull(),
    );
    expect(container.querySelector(".velocity-forecasting-btn.active")).not.toBeNull();

    // The add-new-sprint button inside it opens the create lightbox.
    await act(async () => {
        fireEvent.click(
            container.querySelector(".forecasting-add-sprint .text") as HTMLElement,
        );
    });
    await waitFor(() => expect(mockCaptured.sprintEditProps?.open).toBe(true));
});

test("burndown collapse toggle persists under the legacy key", async () => {
    await renderApp();

    await act(async () => {
        mockCaptured.burndownProps?.onToggleCollapsed();
    });

    await waitFor(() =>
        expect(window.localStorage.getItem("is-burndown-grpahs-collapsed")).toBe("true"),
    );
    expect(mockCaptured.burndownProps?.collapsed).toBe(true);
});

test("revealing closed sprints lazily loads them once", async () => {
    currentClosedSprints = [makeSprint({ id: 20, name: "Old", closed: true })];
    await renderApp();
    expect(mockListMilestones).not.toHaveBeenCalledWith(PROJECT_ID, { closed: true });

    await act(async () => {
        mockCaptured.sprintListProps?.onToggleClosedSprints();
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(mockListMilestones).toHaveBeenCalledWith(PROJECT_ID, { closed: true }),
    );
    await waitFor(() =>
        expect(mockCaptured.sprintListProps?.closedSprintsVisible).toBe(true),
    );
});

/* ========================================================================== */
/* Move-to-sprint (current / latest)                                          */
/* ========================================================================== */

test("move-to-latest sprint moves the CHECKED backlog stories via bulkUpdateMilestone", async () => {
    const { container } = await renderApp();

    // Check the loaded story (keyed by ref) through the captured selection setter.
    await act(async () => {
        mockCaptured.backlogTableProps?.onToggleSelection(1, true, false);
    });

    await act(async () => {
        fireEvent.click(container.querySelector("#move-to-latest-sprint") as HTMLElement);
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(mockBulkUpdateMilestone).toHaveBeenCalledWith(PROJECT_ID, 10, [
            { us_id: 1000, order: 0 },
        ]),
    );
});

test("move-to-sprint is a no-op when no rows are checked", async () => {
    const { container } = await renderApp();

    await act(async () => {
        fireEvent.click(container.querySelector("#move-to-latest-sprint") as HTMLElement);
        await Promise.resolve();
    });

    expect(mockBulkUpdateMilestone).not.toHaveBeenCalled();
});

test("move-to-current sprint targets the sprint spanning today", async () => {
    currentOpenSprints = [
        makeSprint({
            id: 99,
            name: "Current",
            estimated_start: "2000-01-01",
            estimated_finish: "2999-12-31",
        }),
    ];
    const { container } = await renderApp();
    expect(container.querySelector("#move-to-current-sprint")).not.toBeNull();

    await act(async () => {
        mockCaptured.backlogTableProps?.onToggleSelection(1, true, false);
    });
    await act(async () => {
        fireEvent.click(container.querySelector("#move-to-current-sprint") as HTMLElement);
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(mockBulkUpdateMilestone).toHaveBeenCalledWith(PROJECT_ID, 99, [
            { us_id: 1000, order: 0 },
        ]),
    );
});

/* ========================================================================== */
/* Drag & drop: resolveDrop + persist                                          */
/* ========================================================================== */

test("resolveDrop maps a backlog->sprint container drop to a ResolvedDrop", async () => {
    await renderApp();
    const resolve = mockCaptured.dndProps?.resolveDrop;
    expect(resolve).toBeTruthy();

    const resolved = resolve?.(dragEnd(1000, "sprint:10")) ?? null;
    expect(resolved).not.toBeNull();
    expect(resolved?.origin.containerKey).toBe("backlog");
    expect(resolved?.target.containerKey).toBe("sprint:10");
    expect(resolved?.orderedIds).toEqual([1000]);
    expect(resolved?.draggedIds).toEqual([1000]);
});

test("resolveDrop returns null for an unknown / no-op drop", async () => {
    await renderApp();
    const resolve = mockCaptured.dndProps?.resolveDrop;
    // Dropping onto itself.
    expect(resolve?.(dragEnd(1000, 1000))).toBeNull();
    // Unknown dragged id.
    expect(resolve?.(dragEnd(424242, "sprint:10"))).toBeNull();
    // Null target.
    expect(resolve?.(dragEnd(1000, null))).toBeNull();
});

test("persist applies the optimistic move, calls the backlog persister, and reloads", async () => {
    await renderApp();
    const dnd = mockCaptured.dndProps;
    expect(dnd).not.toBeNull();

    const resolved: ResolvedDrop = {
        origin: { containerKey: "backlog", index: 0 },
        target: { containerKey: "sprint:10", index: 0 },
        orderedIds: [1000],
        draggedIds: [1000],
    };
    const neighbors: DropNeighbors = { previous: null, next: null };
    const sprintsBefore = mockListMilestones.mock.calls.length;

    await act(async () => {
        await dnd?.persist(resolved, neighbors);
    });

    // Persister factory + call carried the target milestone + neighbor mapping.
    expect(mockCreateBacklogPersister).toHaveBeenCalledWith(PROJECT_ID);
    expect(mockPersister).toHaveBeenCalledWith({
        milestoneId: 10,
        afterUserstoryId: null,
        beforeUserstoryId: null,
        bulkUserstories: [1000],
    });
    // Optimistic move removed the story from the backlog list.
    await waitFor(() =>
        expect(
            mockCaptured.backlogTableProps?.userstories.some((u) => u.id === 1000),
        ).toBe(false),
    );
    // Collections were reloaded (idempotent post-move refresh).
    await waitFor(() =>
        expect(mockListMilestones.mock.calls.length).toBeGreaterThan(sprintsBefore),
    );
});

test("persist reconciles the server-returned rows after a successful move", async () => {
    await renderApp();
    const dnd = mockCaptured.dndProps;

    // The persister echoes a reconciled row (exercises the response-merge loop).
    mockPersister.mockResolvedValueOnce({
        data: [makeUs({ id: 1000, milestone: 10, sprint_order: 0 })],
        status: 200,
        headers: new Headers(),
    });

    await act(async () => {
        await dnd?.persist(
            {
                origin: { containerKey: "backlog", index: 0 },
                target: { containerKey: "sprint:10", index: 0 },
                orderedIds: [1000],
                draggedIds: [1000],
            },
            { previous: null, next: null },
        );
    });

    expect(mockPersister).toHaveBeenCalledWith({
        milestoneId: 10,
        afterUserstoryId: null,
        beforeUserstoryId: null,
        bulkUserstories: [1000],
    });
    // The optimistic move + reconcile removed the story from the backlog list.
    await waitFor(() =>
        expect(
            mockCaptured.backlogTableProps?.userstories.some((u) => u.id === 1000),
        ).toBe(false),
    );
});

test("persist rolls the optimistic move back when the persister rejects", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderApp();
    const dnd = mockCaptured.dndProps;

    // A single move (backlog -> sprint) whose persistence fails.
    mockPersister.mockImplementationOnce(() =>
        Promise.reject(new Error("network down")),
    );
    await act(async () => {
        await dnd?.persist(
            {
                origin: { containerKey: "backlog", index: 0 },
                target: { containerKey: "sprint:10", index: 0 },
                orderedIds: [1000],
                draggedIds: [1000],
            },
            { previous: null, next: null },
        );
    });

    // Rolled back to `prev` (story still in the backlog).
    await waitFor(() =>
        expect(
            mockCaptured.backlogTableProps?.userstories.some((u) => u.id === 1000),
        ).toBe(true),
    );
    errSpy.mockRestore();
});

test("resolveDrop + persist move a story OUT of a sprint back to the backlog", async () => {
    currentOpenSprints = [
        makeSprint({ id: 10, user_stories: [makeUs({ id: 555, ref: 55 })] }),
    ];
    currentUserstories = [makeUs({ id: 1000, ref: 1 })];
    await renderApp();
    const dnd = mockCaptured.dndProps;

    // Dropping the sprint story onto the backlog container appends it.
    const resolved = dnd?.resolveDrop(dragEnd(555, "backlog")) ?? null;
    expect(resolved).not.toBeNull();
    expect(resolved?.origin.containerKey).toBe("sprint:10");
    expect(resolved?.target.containerKey).toBe("backlog");
    expect(resolved?.orderedIds).toEqual([1000, 555]);

    await act(async () => {
        await dnd?.persist(resolved as ResolvedDrop, { previous: 1000, next: null });
    });

    // Backlog milestone is null; neighbor mapping previous -> afterUserstoryId.
    expect(mockPersister).toHaveBeenCalledWith({
        milestoneId: null,
        afterUserstoryId: 1000,
        beforeUserstoryId: null,
        bulkUserstories: [555],
    });
    // Optimistic insert put the moved story into the backlog list.
    await waitFor(() =>
        expect(
            mockCaptured.backlogTableProps?.userstories.some((u) => u.id === 555),
        ).toBe(true),
    );
});

test("resolveDrop over another row lands at that row's index", async () => {
    currentUserstories = [
        makeUs({ id: 1000, ref: 1 }),
        makeUs({ id: 2000, ref: 2 }),
        makeUs({ id: 3000, ref: 3 }),
    ];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "3" };
    await renderApp();
    const resolve = mockCaptured.dndProps?.resolveDrop;

    // Drag the last row (3000) over the first row (1000) -> index 0 in backlog.
    const resolved = resolve?.(dragEnd(3000, 1000)) ?? null;
    expect(resolved?.target.containerKey).toBe("backlog");
    expect(resolved?.orderedIds[0]).toBe(3000);
});

test("builds all six filter categories (null-id assignees/roles, epics with & without id)", async () => {
    currentFiltersData = {
        statuses: [{ id: 1, name: "New", color: "#fff", count: 2 }],
        tags: [{ name: "urgent", color: "#f00", count: 1 }],
        assigned_users: [
            { id: 7, full_name: "Alice", count: 2 },
            { id: null, full_name: null, count: 5 },
        ],
        roles: [
            { id: 3, name: "Dev", count: 1 },
            { id: null, name: null, count: 0 },
        ],
        owners: [{ id: 9, full_name: "Bob", count: 3 }],
        epics: [
            { id: 100, ref: 12, subject: "Epic A", count: 1 },
            { id: null, count: 4 },
        ],
    };
    const { container } = await renderApp();

    await act(async () => {
        fireEvent.click(container.querySelector("#show-filters-button") as HTMLElement);
    });
    await waitFor(() => expect(container.querySelector("#backlog-filter")).not.toBeNull());

    // All six categories present.
    expect(container.querySelectorAll(".filter-category").length).toBe(6);
    // Null-id assignee/role -> "Unassigned"; epic without id -> "Not in an epic".
    const text = container.querySelector("#backlog-filter")?.textContent ?? "";
    expect(text).toContain("Unassigned");
    expect(text).toContain("Not in an epic");
    expect(text).toContain("Bob");
    expect(text).toContain("#12 Epic A");
});

test("tolerates stats / sprints / userstories / filters load failures without crashing", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    // Project succeeds; every dependent collection fails.
    mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
        const path = String(args[0]);
        if (path === `projects/${PROJECT_ID}`) {
            return Promise.resolve(mkRes(makeProject()));
        }
        return Promise.reject(new HttpError(500, "Server Error", null, path));
    });
    mockListMilestones.mockImplementation(() => Promise.reject(new Error("boom")));
    mockFiltersData.mockImplementation(() => Promise.reject(new Error("boom")));

    const { container } = await renderApp();

    // The shell still renders (failures are caught + logged, never thrown).
    expect(container.querySelector(".backlog")).not.toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
});

/* ========================================================================== */
/* WebSocket subscription callbacks                                            */
/* ========================================================================== */

test("the userstories subscription callback reloads stories and sprints", async () => {
    await renderApp();
    const call = mockEventsClient.subscribe.mock.calls.find(
        (c) => c[0] === `changes.project.${PROJECT_ID}.userstories`,
    );
    expect(call).toBeTruthy();
    const cb = call?.[1] as () => void;

    const usBefore = countGet((p) => p === "userstories");
    const sprintsBefore = mockListMilestones.mock.calls.length;

    await act(async () => {
        cb();
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore),
    );
    expect(mockListMilestones.mock.calls.length).toBeGreaterThan(sprintsBefore);
});

test("the milestones subscription callback reloads open + closed sprints and stats", async () => {
    await renderApp();
    const call = mockEventsClient.subscribe.mock.calls.find(
        (c) => c[0] === `changes.project.${PROJECT_ID}.milestones`,
    );
    expect(call).toBeTruthy();
    const cb = call?.[1] as () => void;

    const statsBefore = countGet((p) => p.includes("/stats"));

    await act(async () => {
        cb();
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(mockListMilestones).toHaveBeenCalledWith(PROJECT_ID, { closed: true }),
    );
    expect(countGet((p) => p.includes("/stats"))).toBeGreaterThan(statsBefore);
});

test("disconnects the shared events client on unmount", async () => {
    const { unmount } = await renderApp();
    expect(mockEventsClient.disconnect).not.toHaveBeenCalled();

    act(() => {
        unmount();
    });

    expect(mockEventsClient.disconnect).toHaveBeenCalledTimes(1);
});

/* ========================================================================== */
/* Empty-state rendering                                                       */
/* ========================================================================== */

test("renders the empty-large state and its create button when the backlog is empty", async () => {
    currentUserstories = [];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "0" };
    const { container } = await renderApp();

    // With no stories and no search, the large empty state is visible (not hidden)
    // and the board section is hidden.
    const emptyLarge = container.querySelector(".empty-large");
    expect(emptyLarge?.classList.contains("hidden")).toBe(false);
    expect(
        container.querySelector("section.backlog-table")?.classList.contains("hidden"),
    ).toBe(true);

    // The show-tags control is gone (no stories).
    expect(container.querySelector("#show-tags")).toBeNull();

    // Its create button triggers a standard add (broadcast no-op without Angular).
    await act(async () => {
        fireEvent.click(container.querySelector(".empty-large .btn-small") as HTMLElement);
    });
    expect(mockCaptured.bulkProps?.open).toBe(false);
});

test("hides the create button in the empty state without the add_us permission", async () => {
    currentUserstories = [];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "0" };
    currentProject = makeProject({ my_permissions: ["add_milestone", "modify_us"] });
    const { container } = await renderApp();

    expect(container.querySelector(".new-us .btn-small")).toBeNull();
    expect(container.querySelector(".empty-large .btn-small")).toBeNull();
});

/* ========================================================================== */
/* Additional branch coverage: edge cases in the mutation / move handlers      */
/* ========================================================================== */

test("onMoveToTop is a no-op when the story is already first", async () => {
    await renderApp();
    await act(async () => {
        // The loaded story has id 1000 and is the first (only) backlog row.
        mockCaptured.backlogTableProps?.actions.onMoveToTop(makeUs({ id: 1000 }));
        await Promise.resolve();
    });
    expect(mockBulkUpdateBacklogOrder).not.toHaveBeenCalled();
});

test("onMoveToTop is a no-op when the backlog is empty", async () => {
    currentUserstories = [];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "0" };
    await renderApp();
    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onMoveToTop(makeUs({ id: 1000 }));
        await Promise.resolve();
    });
    expect(mockBulkUpdateBacklogOrder).not.toHaveBeenCalled();
});

test("onMoveToTop optimistically reorders an in-backlog story and reconciles the response", async () => {
    currentUserstories = [makeUs({ id: 1000, ref: 1 }), makeUs({ id: 2000, ref: 2 })];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "2" };
    await renderApp();
    mockBulkUpdateBacklogOrder.mockImplementationOnce(() =>
        Promise.resolve(mkRes([makeUs({ id: 2000, milestone: null, backlog_order: 0 })])),
    );

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onMoveToTop(makeUs({ id: 2000 }));
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(mockBulkUpdateBacklogOrder).toHaveBeenCalledWith(
            PROJECT_ID,
            null,
            null,
            1000,
            [2000],
        ),
    );
    // Optimistic splice put 2000 at the top of the backlog list.
    await waitFor(() =>
        expect(mockCaptured.backlogTableProps?.userstories[0].id).toBe(2000),
    );
});

test("onMoveToTop rolls back the optimistic reorder when the request fails", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    currentUserstories = [makeUs({ id: 1000, ref: 1 }), makeUs({ id: 2000, ref: 2 })];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "2" };
    await renderApp();
    mockBulkUpdateBacklogOrder.mockImplementationOnce(() =>
        Promise.reject(new Error("nope")),
    );

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onMoveToTop(makeUs({ id: 2000 }));
        await Promise.resolve();
    });

    // Rolled back -> original order (1000 first) restored.
    await waitFor(() =>
        expect(mockCaptured.backlogTableProps?.userstories[0].id).toBe(1000),
    );
    errSpy.mockRestore();
});

test("onChangeStatus reports (does not reload) on a non-409 failure", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderApp();
    mockHttpPatch.mockImplementation(() =>
        Promise.reject(new HttpError(500, "Server Error", null, "userstories/1000")),
    );
    const usBefore = countGet((p) => p === "userstories");

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onChangeStatus(makeUs({ id: 1000 }), 9);
        await Promise.resolve();
    });

    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    // A non-conflict error does NOT trigger a backlog reload.
    expect(countGet((p) => p === "userstories")).toBe(usBefore);
    errSpy.mockRestore();
});

test("onChangePoints reloads the backlog on a 409 conflict", async () => {
    await renderApp();
    mockHttpPatch.mockImplementation(() =>
        Promise.reject(new HttpError(409, "Conflict", null, "userstories/1000")),
    );
    const usBefore = countGet((p) => p === "userstories");

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onChangePoints(makeUs({ id: 1000 }), 1, 5);
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore),
    );
});

test("addNewSprint picks the latest-finishing open sprint among several", async () => {
    currentOpenSprints = [
        makeSprint({ id: 10, name: "S1", estimated_finish: "2021-01-15" }),
        makeSprint({ id: 11, name: "S2", estimated_finish: "2021-02-15" }),
    ];
    await renderApp();

    await act(async () => {
        mockCaptured.sprintListProps?.onAddNewSprint();
    });

    await waitFor(() => expect(mockCaptured.sprintEditProps?.open).toBe(true));
    const p = mockCaptured.sprintEditProps;
    expect(p?.lastSprintName).toBe("S2");
    expect(p?.initialValues.estimated_start).toBe("2021-02-15");
    expect(p?.initialValues.estimated_finish).toBe("2021-03-01");
});

test("move-to-sprint is a no-op when there is no resolvable target sprint", async () => {
    currentOpenSprints = [];
    const { container } = await renderApp();

    await act(async () => {
        mockCaptured.backlogTableProps?.onToggleSelection(1, true, false);
    });
    await act(async () => {
        fireEvent.click(container.querySelector("#move-to-latest-sprint") as HTMLElement);
        await Promise.resolve();
    });

    expect(mockBulkUpdateMilestone).not.toHaveBeenCalled();
});

test("move-to-sprint refreshes closed sprints too when they are visible", async () => {
    currentClosedSprints = [makeSprint({ id: 20, name: "Old", closed: true })];
    const { container } = await renderApp();

    // Reveal closed sprints first (one closed:true fetch).
    await act(async () => {
        mockCaptured.sprintListProps?.onToggleClosedSprints();
        await Promise.resolve();
    });
    await waitFor(() =>
        expect(mockListMilestones).toHaveBeenCalledWith(PROJECT_ID, { closed: true }),
    );
    const closedBefore = mockListMilestones.mock.calls.filter(
        (c) => (c[1] as { closed?: boolean })?.closed === true,
    ).length;

    await act(async () => {
        mockCaptured.backlogTableProps?.onToggleSelection(1, true, false);
    });
    await act(async () => {
        fireEvent.click(container.querySelector("#move-to-latest-sprint") as HTMLElement);
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(
            mockListMilestones.mock.calls.filter(
                (c) => (c[1] as { closed?: boolean })?.closed === true,
            ).length,
        ).toBeGreaterThan(closedBefore),
    );
});

test("move-to-sprint reports a failure without throwing", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = await renderApp();
    mockBulkUpdateMilestone.mockImplementation(() => Promise.reject(new Error("nope")));

    await act(async () => {
        mockCaptured.backlogTableProps?.onToggleSelection(1, true, false);
    });
    await act(async () => {
        fireEvent.click(container.querySelector("#move-to-latest-sprint") as HTMLElement);
        await Promise.resolve();
    });

    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
});

test("onLoadMore requests the next page (reset:false) via the userstories endpoint", async () => {
    await renderApp();
    const usBefore = countGet((p) => p === "userstories");

    await act(async () => {
        mockCaptured.backlogTableProps?.onLoadMore();
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore),
    );
});

/* ========================================================================== */
/* F-PAG: pagination "has next page" header drives canLoadMore                */
/* ========================================================================== */

test("canLoadMore is true when the userstories response carries x-pagination-next", async () => {
    // Every other fixture returns empty headers, so the truthy branch of
    // `if (header('x-pagination-next'))` — hasNextPage -> disablePagination=false
    // -> canLoadMore=true — is otherwise never observed, and a mutation flipping
    // that condition survives. Set the header BEFORE the initial reset-load.
    currentUsHeaders = {
        "x-pagination-next": "1",
        "Taiga-Info-Backlog-Total-Userstories": "1",
    };

    await renderApp();

    await waitFor(() => expect(mockCaptured.backlogTableProps?.canLoadMore).toBe(true));
});

test("canLoadMore is false when x-pagination-next is absent", async () => {
    // Default fixture: no x-pagination-next -> hasNextPage false ->
    // disablePagination true -> canLoadMore false.
    await renderApp();

    await waitFor(() => expect(mockCaptured.backlogTableProps).not.toBeNull());
    expect(mockCaptured.backlogTableProps?.canLoadMore).toBe(false);
});
