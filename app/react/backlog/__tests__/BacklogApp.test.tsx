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
import { generateHash } from "../../shared/util/hash";
import type { ReactNode } from "react";
import type { DragEndEvent } from "@dnd-kit/core";

import { BacklogApp } from "../BacklogApp";
import type { Project, ProjectStats, Sprint, UserStory } from "../types";
import type { BacklogTableProps } from "../BacklogTable";
import type { BurndownProps } from "../Burndown";
import type { SprintListProps } from "../SprintList";
import type { SprintEditLightboxProps } from "../SprintEditLightbox";
import type { BulkUserStoriesLightboxProps } from "../BulkUserStoriesLightbox";
import type { UserStoryEditLightboxProps } from "../UserStoryEditLightbox";
import type {
    DndProviderProps,
    NormalizedDragEnd,
    ResolvedDrop,
    DropNeighbors,
} from "../../shared/dnd/DndProvider";

import {
    httpGet,
    httpPatch,
    httpDelete,
    httpPut,
    httpPost,
    HttpError,
} from "../../shared/api/httpClient";
import { storageHash } from "../../shared/api/userStorage";
import { list as listMilestones } from "../../shared/api/milestones";
import {
    filtersData,
    bulkUpdateBacklogOrder,
    bulkUpdateMilestone,
    bulkCreate,
} from "../../shared/api/userstories";
import { createEventsClient } from "../../shared/events/websocket";
import { createBacklogPersister, isDragEnabled } from "../../shared/dnd/DndProvider";
// REAL modules (NOT mocked) — the same instances BacklogApp wires into, so the
// test can drive the installed interceptor hooks and inspect the bus ([ERR-1/2]).
import { getInterceptorHooks, resetInterceptorHooks } from "../../shared/api/httpInterceptor";
import {
    clearNotificationListeners,
    subscribeNotifications,
} from "../../shared/notifications/notificationCenter";

// WebSocket-driven board refreshes are coalesced through a pure-trailing
// lodash debounce (EVENTS_DEBOUNCE_MS = 1000ms in BacklogApp, mirroring the
// AngularJS `debounceLeading` = {leading:false, trailing:true}). A single
// `.userstories`/`.milestones`/`.projects` event therefore reloads the board
// only after the debounce settles (Issue 2: collapse a burst of events into
// one trailing refetch). Assertions on the post-event reload must poll past
// that window, so give them a timeout comfortably larger than the debounce.
const WS_REFRESH_TIMEOUT = 3000;

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
    userStoryEditProps: UserStoryEditLightboxProps | null;
    burndownProps: BurndownProps | null;
}
const mockCaptured: Captured = {
    backlogTableProps: null,
    dndProps: null,
    sprintListProps: null,
    sprintEditProps: null,
    bulkProps: null,
    userStoryEditProps: null,
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

jest.mock("../UserStoryEditLightbox", () => ({
    __esModule: true,
    UserStoryEditLightbox: (props: UserStoryEditLightboxProps) => {
        mockCaptured.userStoryEditProps = props;
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
const mockHttpPut = httpPut as unknown as AsyncMock;
const mockHttpPost = httpPost as unknown as AsyncMock;
const mockListMilestones = listMilestones as unknown as AsyncMock;
const mockFiltersData = filtersData as unknown as AsyncMock;
const mockBulkUpdateBacklogOrder = bulkUpdateBacklogOrder as unknown as AsyncMock;
const mockBulkUpdateMilestone = bulkUpdateMilestone as unknown as AsyncMock;
const mockBulkCreate = bulkCreate as unknown as AsyncMock;
const mockCreateEventsClient = jest.mocked(createEventsClient);
const mockCreateBacklogPersister = createBacklogPersister as unknown as jest.Mock;
const mockIsDragEnabled = isDragEnabled as unknown as jest.Mock;

/* -------------------------------------------------------------------------- */
/* Test data factories (shapes mirror the sibling specs)                       */
/* -------------------------------------------------------------------------- */

const PROJECT_ID = 5;

// N-01 — the EXACT legacy hashed localStorage keys the AngularJS backlog used,
// computed via the same ported `generateHash` helper. Tests assert against these
// so a regression to an approximated key (which would orphan real user settings)
// is caught.
const SHOW_TAGS_KEY = generateHash([PROJECT_ID, `${PROJECT_ID}:backlog-tags`]);
const BURNDOWN_COLLAPSED_KEY_EXACT = generateHash(["is-burndown-grpahs-collapsed"]);

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
        // URL-slug fallback resolution (QA #1): `GET projects/by_slug?slug=...`
        // returns the full project, exactly like `projects/{id}`.
        if (path === "projects/by_slug") {
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
    // user-storage writes (custom filters, QA [J]) resolve happily by default.
    mockHttpPut.mockImplementation(() => Promise.resolve(mkRes(undefined)));
    mockHttpPost.mockImplementation(() => Promise.resolve(mkRes(undefined)));
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
    mockCaptured.userStoryEditProps = null;
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
/* (a1) document.title / meta parity (F-001)                                   */
/* ========================================================================== */

describe("BacklogApp — document.title / meta parity (F-001)", () => {
    afterEach(() => {
        // Do not leak a page title/description into unrelated specs.
        document.title = "";
        document.head
            .querySelectorAll('meta[name="description"]')
            .forEach((el) => el.remove());
    });

    test("sets the tab title to 'Backlog - <projectName>' once the project resolves", async () => {
        await renderApp();

        // No Angular injector in jsdom → t() uses the English fallback,
        // interpolating the fixture project name ("My Project").
        expect(document.title).toBe("Backlog - My Project");
    });

    test("sets a meta description that interpolates the project name", async () => {
        await renderApp();

        const description = document.head
            .querySelector('meta[name="description"]')
            ?.getAttribute("content");
        expect(description).toBeTruthy();
        expect(description).toContain("My Project");
        expect(description).toContain("backlog panel");
    });

    test("re-applies the title on remount, curing a stale SPA-transition title", async () => {
        const first = await renderApp();
        expect(document.title).toBe("Backlog - My Project");
        first.unmount();

        // Simulate an AngularJS route (e.g. the Sprint Taskboard) having set its
        // own title while the React root was unmounted.
        document.title = "Sprint 2026 - Sprint taskboard - Other Project";

        await renderApp();
        expect(document.title).toBe("Backlog - My Project");
    });
});

/* ========================================================================== */
/* (a2) Project-id validity, URL-slug fallback, error-state reset (QA #1)      */
/* ========================================================================== */

test("treats projectId 0 as unresolved — never issues GET /projects/0 (QA #1)", async () => {
    // An empty `data-project-id` interpolates to `Number("") === 0`. Zero is NOT
    // a valid id and must never reach the network (the original defect issued
    // `GET /projects/0` → 404). With no URL slug (jsdom's default "/" path)
    // there is nothing to resolve, so no request is made.
    const { container } = render(<BacklogApp projectId={0} projectSlug="my-project" />);

    await act(async () => {
        await Promise.resolve();
    });

    expect(mockHttpGet).not.toHaveBeenCalled();
    expect(countGet((p) => p === "projects/0")).toBe(0);
    expect(container.querySelector("main.main.scrum")).not.toBeNull();
    expect(container.querySelector(".backlog-table")).toBeNull();
});

test("resolves the project from the URL slug via projects/by_slug when the prop id is unusable (QA #1)", async () => {
    // Production reality: the migrated shell never interpolates a usable id, so
    // the prop is NaN; the real slug lives in the route URL (/project/:pslug/…).
    const original = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", "/project/my-project/backlog");
    try {
        const { container } = render(
            <BacklogApp projectId={Number.NaN} projectSlug="" />,
        );

        // The board loads fully off the slug-resolved id — never GET /projects/0.
        await waitFor(() => expect(container.querySelector(".backlog")).not.toBeNull());

        // Resolution went through the by_slug endpoint with the URL slug…
        expect(mockHttpGet).toHaveBeenCalledWith("projects/by_slug", { slug: "my-project" });
        // …and NEVER through the invalid ids 0 / NaN.
        expect(countGet((p) => p === "projects/0")).toBe(0);
        expect(countGet((p) => p === "projects/NaN")).toBe(0);
        // Downstream loaders keyed off the RESOLVED id (PROJECT_ID = 5).
        expect(countGet((p) => p === `projects/${PROJECT_ID}/stats`)).toBeGreaterThan(0);
        expect(mockListMilestones).toHaveBeenCalledWith(PROJECT_ID, { closed: false });
        expect(mockEventsClient.subscribe).toHaveBeenCalledWith(
            `changes.project.${PROJECT_ID}.userstories`,
            expect.any(Function),
        );
    } finally {
        window.history.replaceState(null, "", original);
    }
});

test("[ERR-3] clears a stale permission-denied when the project changes to an accessible one", async () => {
    // First project (id 5) is blocked (403) → permission-denied. A subsequent
    // load of an accessible project must reset the stale gate state at the START
    // of loadProject so the board renders instead of staying denied.
    mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
        const path = String(args[0]);
        if (path === `projects/${PROJECT_ID}`) {
            return Promise.reject(new HttpError(403, "Forbidden", null, "projects/5"));
        }
        if (path === "projects/6") {
            return Promise.resolve(mkRes(makeProject({ id: 6, slug: "other" })));
        }
        if (path.includes("/stats")) {
            return Promise.resolve(mkRes(currentStats));
        }
        if (path === "userstories") {
            return Promise.resolve(mkRes(currentUserstories, currentUsHeaders));
        }
        return Promise.resolve(mkRes({}));
    });

    const { container, rerender } = render(
        <BacklogApp projectId={PROJECT_ID} projectSlug="my-project" />,
    );
    await waitFor(() =>
        expect(container.querySelector(".permission-denied")).not.toBeNull(),
    );

    // Switch to an accessible project (id 6).
    rerender(<BacklogApp projectId={6} projectSlug="other" />);
    await waitFor(() => expect(container.querySelector(".backlog")).not.toBeNull());
    expect(container.querySelector(".permission-denied")).toBeNull();
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
    // C-05 — the Backlog now ALSO subscribes to project-attribute events so its
    // permission / module / archive / metadata gates never go stale.
    expect(mockEventsClient.subscribe).toHaveBeenCalledWith(
        `changes.project.${PROJECT_ID}.projects`,
        expect.any(Function),
    );
});

test("C-05: a .projects event refreshes the project record and reconciles dependent state", async () => {
    await renderApp();

    // Locate the handler registered for the `.projects` routing key.
    const projectsCall = mockEventsClient.subscribe.mock.calls.find(
        (c) => c[0] === `changes.project.${PROJECT_ID}.projects`,
    );
    expect(projectsCall).toBeDefined();
    const projectsHandler = projectsCall?.[1] as (data?: unknown) => void;

    // Baseline: how many times the project was fetched during initial load.
    const projectGetsBefore = countGet((p) => p === `projects/${PROJECT_ID}`);
    const milestoneCallsBefore = mockListMilestones.mock.calls.length;

    // Fire a project-attribute change (e.g. a permission/module/status edit).
    await act(async () => {
        projectsHandler({ matches: "projects.userstorystatus" });
    });

    // The authoritative project record is re-fetched (re-evaluating every gate),
    // and dependent data (sprints/stories/stats) is reconciled. The refresh is
    // debounced (pure-trailing, EVENTS_DEBOUNCE_MS), so poll past that window.
    await waitFor(
        () => {
            expect(
                countGet((p) => p === `projects/${PROJECT_ID}`),
            ).toBeGreaterThan(projectGetsBefore);
            expect(mockListMilestones.mock.calls.length).toBeGreaterThan(
                milestoneCallsBefore,
            );
        },
        { timeout: WS_REFRESH_TIMEOUT },
    );
});

test("C-05: a .projects event that revokes module activation gates the screen", async () => {
    const { container } = await renderApp();

    const projectsCall = mockEventsClient.subscribe.mock.calls.find(
        (c) => c[0] === `changes.project.${PROJECT_ID}.projects`,
    );
    const projectsHandler = projectsCall?.[1] as (data?: unknown) => void;

    // Before the event the board is live (no permission-denied gate).
    expect(container.querySelector(".permission-denied")).toBeNull();

    // A server-side change deactivates the Backlog module; the next project
    // fetch reflects it.
    currentProject = makeProject({ is_backlog_activated: false });

    await act(async () => {
        projectsHandler({ matches: "projects.project" });
    });

    // The permission-denied gate now renders live (module activation went stale
    // before C-05; the `.projects` subscription refreshes it in place). The
    // refresh is debounced (pure-trailing, EVENTS_DEBOUNCE_MS), so poll past it.
    await waitFor(
        () => expect(container.querySelector(".permission-denied")).not.toBeNull(),
        { timeout: WS_REFRESH_TIMEOUT },
    );
});

test("renders the header controls: add, bulk, filters button, search, move-to-latest, forecasting", async () => {
    const { container } = await renderApp();

    // addnewus.jade (add_us permission present).
    expect(container.querySelector(".new-us .btn-small")).not.toBeNull();
    expect(container.querySelector(".new-us .btn-icon")).not.toBeNull();
    // Filters toggle + search. [#6] The search box is a REAL `tg-input-search`
    // custom element (tag, not a class) wrapping the input and a `tg-svg`
    // magnifier, mirroring the Kanban search so the tag-selector SCSS applies.
    expect(container.querySelector("#show-filters-button")).not.toBeNull();
    const searchHost = container.querySelector("tg-input-search");
    expect(searchHost).not.toBeNull();
    const searchInput = searchHost?.querySelector(
        "input.backlog-search.e2e-search",
    ) as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();
    expect(searchInput?.getAttribute("placeholder")).toBe("subject or reference");
    // The magnifier icon child (positioned by input-search.component.scss).
    expect(searchHost?.querySelector("tg-svg svg.icon-search")).not.toBeNull();
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

test("onChangeStatus reloads the backlog on a version conflict (HTTP 400 + version body)", async () => {
    await renderApp();
    // [W1-1] The FROZEN backend signals an OCC version conflict as HTTP 400 with
    // a {"version": "..."} body (WrongArguments -> BadRequest), NOT 409.
    mockHttpPatch.mockImplementation(() =>
        Promise.reject(
            new HttpError(
                400,
                "Bad Request",
                { version: "The version doesn't match with the current one" },
                "userstories/1000",
            ),
        ),
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
/* (e) [#2] Edit entry point opens the React-owned UserStoryEditLightbox        */
/* ========================================================================== */

// The migrated backlog.jade removed the Angular `tg-lb-create-edit` host, so the
// old `broadcastToAngular("genericform:edit")` bridge was a dead no-op (QA #2).
// The row-kebab "Edit" action now opens `UserStoryEditLightbox` in edit mode
// seeded with the target story. These assertions encode that new contract
// (rule D1: tests conform to the design, not vice-versa).

test("edit action opens the React edit lightbox and does not PATCH by itself", async () => {
    await renderApp();
    const props = mockCaptured.backlogTableProps;
    expect(props).not.toBeNull();

    // The lightbox starts closed.
    expect(mockCaptured.userStoryEditProps?.open).toBe(false);

    expect(() => {
        act(() => {
            props?.actions.onEditUserStory(makeUs({ id: 7 }));
        });
    }).not.toThrow();

    // Merely opening the editor must not fire a PATCH — persistence happens only
    // when the user saves (asserted by the create/edit persistence tests below).
    expect(mockHttpPatch).not.toHaveBeenCalled();
});

test("edit action opens the lightbox in edit mode seeded with the target story", async () => {
    await renderApp();

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onEditUserStory(makeUs({ id: 7 }));
    });

    const usProps = mockCaptured.userStoryEditProps;
    expect(usProps?.open).toBe(true);
    expect(usProps?.mode).toBe("edit");
    expect(usProps?.us?.id).toBe(7);
    // The bulk lightbox must stay closed — the two are independent.
    expect(mockCaptured.bulkProps?.open).toBe(false);
});

/* ========================================================================== */
/* Delete user story: confirm + DELETE + reload; restore on failure           */
/* ========================================================================== */

// [H] The delete confirmation is the themed ConfirmDialog (.lightbox-generic-delete),
// NOT the native window.confirm. `onDeleteUserStory` OPENS the dialog; the DELETE
// only runs after the dialog's confirm (.js-confirm) button is clicked.
function openDeleteDialog(us: UserStory): HTMLElement {
    act(() => {
        mockCaptured.backlogTableProps?.actions.onDeleteUserStory(us);
    });
    const dialog = document.querySelector(".lightbox-generic-delete.open") as HTMLElement | null;
    expect(dialog).not.toBeNull();
    return dialog as HTMLElement;
}

test("onDeleteUserStory confirms via the themed dialog, DELETEs, and reloads stats + sprints", async () => {
    await renderApp();
    const sprintsBefore = mockListMilestones.mock.calls.length;

    // Opening the delete flow shows the ConfirmDialog; no DELETE has fired yet.
    const dialog = openDeleteDialog(makeUs({ id: 1000 }));
    expect(mockHttpDelete).not.toHaveBeenCalled();

    // Confirm → the DELETE runs.
    await act(async () => {
        fireEvent.click(dialog.querySelector(".js-confirm") as HTMLElement);
        await Promise.resolve();
    });

    await waitFor(() =>
        expect(mockHttpDelete).toHaveBeenCalledWith("userstories/1000"),
    );
    await waitFor(() =>
        expect(mockListMilestones.mock.calls.length).toBeGreaterThan(sprintsBefore),
    );
});

test("onDeleteUserStory is a no-op when the confirm dialog is cancelled", async () => {
    await renderApp();

    const dialog = openDeleteDialog(makeUs({ id: 1000 }));

    // Cancel → dialog closes, nothing is deleted.
    await act(async () => {
        fireEvent.click(dialog.querySelector(".js-cancel") as HTMLElement);
        await Promise.resolve();
    });

    expect(mockHttpDelete).not.toHaveBeenCalled();
    expect(document.querySelector(".lightbox-generic-delete.open")).toBeNull();
});

test("onDeleteUserStory restores the story when the DELETE fails", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderApp();
    mockHttpDelete.mockImplementation(() =>
        Promise.reject(new HttpError(500, "Server Error", null, "userstories/1000")),
    );

    const dialog = openDeleteDialog(makeUs({ id: 1000 }));
    await act(async () => {
        fireEvent.click(dialog.querySelector(".js-confirm") as HTMLElement);
        await Promise.resolve();
    });

    // After the rejection the optimistic removal is rolled back -> the story is
    // present again in the table props.
    await waitFor(() =>
        expect(
            mockCaptured.backlogTableProps?.userstories.some((u) => u.id === 1000),
        ).toBe(true),
    );
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

test("clicking Add opens the React create lightbox and does NOT open the bulk lightbox", async () => {
    const { container } = await renderApp();

    // [#2] The header "+ ADD" standard-create path now opens the React-owned
    // `UserStoryEditLightbox` in "create" mode (the old `genericform:new`
    // broadcast targeted an Angular host removed by the migrated backlog.jade).
    // Assert the create lightbox opens AND the bulk lightbox stays closed — the
    // two "Add" affordances are independent.
    await act(async () => {
        fireEvent.click(container.querySelector(".new-us .btn-small") as HTMLElement);
    });

    const usProps = mockCaptured.userStoryEditProps;
    expect(usProps?.open).toBe(true);
    expect(usProps?.mode).toBe("create");
    // No pre-existing story is seeded in create mode.
    expect(usProps?.us == null).toBe(true);
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

test("[#3] onBulkCreated at the bottom refreshes project stats (not just the 'top' path)", async () => {
    await renderApp();
    const usBefore = countGet((p) => p === "userstories");
    const statsBefore = countGet((p) => p.includes("/stats"));

    await act(async () => {
        await mockCaptured.bulkProps?.onCreated([makeUs({ id: 3100 })], "bottom");
    });

    await waitFor(() => expect(mockCaptured.bulkProps?.open).toBe(false));
    // Backlog list reloaded ...
    expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore);
    // ... AND stats were reloaded even though position is "bottom" (no top reorder).
    // Regression guard for QA #3: sidebar totals / burndown were previously stale
    // after a bottom bulk-create because loadProjectStats() was gated on the
    // `position === "top"` branch.
    await waitFor(() =>
        expect(countGet((p) => p.includes("/stats"))).toBeGreaterThan(statsBefore),
    );
    expect(mockBulkUpdateBacklogOrder).not.toHaveBeenCalled();
});

/* ========================================================================== */
/* [#2] Single user-story create/edit persistence (UserStoryEditLightbox)      */
/* ========================================================================== */

// These exercise the `onCreate` / `onEdit` contract callbacks that BacklogApp
// hands to `UserStoryEditLightbox`. They prove the round-trip that jsdom's
// runtime cannot: create -> POST bulk_create (+ optional follow-up PATCH) ->
// backlog re-read; edit -> PATCH userstories/{id} -> stats + backlog re-read.

test("onCreate (no points/assignee) POSTs bulk_create with subject+status and reloads", async () => {
    await renderApp();
    // bulk_create returns the freshly created story so `onBulkCreated` has data.
    mockBulkCreate.mockImplementationOnce(() =>
        Promise.resolve(mkRes([makeUs({ id: 2000, subject: "Fresh", version: 1 })])),
    );
    const usBefore = countGet((p) => p === "userstories");

    await act(async () => {
        await mockCaptured.userStoryEditProps?.onCreate({
            subject: "Fresh",
            statusId: 1,
            points: {},
            assignedTo: null,
            position: "bottom",
            // M-10 generic-form secondary fields, all at their create defaults so
            // this "subject only" create still departs from none of them.
            description: "",
            tags: [],
            due_date: null,
            is_blocked: false,
            blocked_note: "",
            team_requirement: false,
            client_requirement: false,
            swimlane: null,
            attachmentsToAdd: [],
        });
    });

    // subject + status carried by bulk_create; swimlane is null on the backlog.
    expect(mockBulkCreate).toHaveBeenCalledWith(PROJECT_ID, 1, "Fresh", null);
    // No points/assignee and every secondary field at default => no follow-up PATCH.
    expect(mockHttpPatch).not.toHaveBeenCalled();
    // Backlog re-read (onBulkCreated).
    await waitFor(() =>
        expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore),
    );
});

test("onCreate with points/assignee issues a follow-up PATCH on the new story", async () => {
    await renderApp();
    mockBulkCreate.mockImplementationOnce(() =>
        Promise.resolve(mkRes([makeUs({ id: 2001, subject: "WithMeta", version: 4 })])),
    );

    await act(async () => {
        await mockCaptured.userStoryEditProps?.onCreate({
            subject: "WithMeta",
            statusId: 1,
            points: { "1": 11 },
            assignedTo: 42,
            position: "bottom",
            description: "",
            tags: [],
            due_date: null,
            is_blocked: false,
            blocked_note: "",
            team_requirement: false,
            client_requirement: false,
            swimlane: null,
            attachmentsToAdd: [],
        });
    });

    expect(mockBulkCreate).toHaveBeenCalledWith(PROJECT_ID, 1, "WithMeta", null);
    // Follow-up PATCH persists points + assignee (plus the full generic-form
    // field set, at defaults here) against the created story's id, carrying the
    // created story's version for optimistic concurrency.
    await waitFor(() =>
        expect(mockHttpPatch).toHaveBeenCalledWith("userstories/2001", {
            points: { "1": 11 },
            assigned_to: 42,
            description: "",
            tags: [],
            due_date: null,
            is_blocked: false,
            blocked_note: "",
            team_requirement: false,
            client_requirement: false,
            version: 4,
        }),
    );
});

test("onCreate with position 'top' reorders the new story to the top", async () => {
    await renderApp();
    mockBulkCreate.mockImplementationOnce(() =>
        Promise.resolve(mkRes([makeUs({ id: 2002, subject: "TopStory", version: 1 })])),
    );

    await act(async () => {
        await mockCaptured.userStoryEditProps?.onCreate({
            subject: "TopStory",
            statusId: 1,
            points: {},
            assignedTo: null,
            position: "top",
            description: "",
            tags: [],
            due_date: null,
            is_blocked: false,
            blocked_note: "",
            team_requirement: false,
            client_requirement: false,
            swimlane: null,
            attachmentsToAdd: [],
        });
    });

    await waitFor(() =>
        expect(mockBulkUpdateBacklogOrder).toHaveBeenCalledWith(
            PROJECT_ID,
            null,
            null,
            1000,
            [2002],
        ),
    );
});

test("onEdit PATCHes userstories/{id} with the changed fields + version and reloads", async () => {
    await renderApp();
    const statsBefore = countGet((p) => p.includes("/stats"));
    const usBefore = countGet((p) => p === "userstories");

    await act(async () => {
        await mockCaptured.userStoryEditProps?.onEdit(makeUs({ id: 1000, version: 7 }), {
            subject: "Edited subject",
            status: 101,
            points: { "1": 11 },
            assigned_to: 42,
            description: "",
            tags: [],
            due_date: null,
            is_blocked: false,
            blocked_note: "",
            team_requirement: false,
            client_requirement: false,
            attachmentsToDelete: [],
            swimlane: null,
            attachmentsToAdd: [],
        });
    });

    expect(mockHttpPatch).toHaveBeenCalledWith("userstories/1000", {
        subject: "Edited subject",
        status: 101,
        points: { "1": 11 },
        assigned_to: 42,
        // BL-01: the edit PATCH now carries the swimlane (null here — the edited
        // story has no swimlane and the fixture defines none).
        swimlane: null,
        description: "",
        tags: [],
        due_date: null,
        is_blocked: false,
        blocked_note: "",
        team_requirement: false,
        client_requirement: false,
        version: 7,
    });
    await waitFor(() =>
        expect(countGet((p) => p.includes("/stats"))).toBeGreaterThan(statsBefore),
    );
    await waitFor(() =>
        expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore),
    );
});

test("onEdit reloads the backlog and rethrows on a version conflict (HTTP 400 + version body)", async () => {
    await renderApp();
    // [W1-1] The FROZEN backend signals an OCC version conflict as HTTP 400 with
    // a {"version": "..."} body (WrongArguments -> BadRequest), NOT 409.
    mockHttpPatch.mockImplementation(() =>
        Promise.reject(
            new HttpError(
                400,
                "Bad Request",
                { version: "The version doesn't match with the current one" },
                "userstories/1000",
            ),
        ),
    );
    const usBefore = countGet((p) => p === "userstories");

    // Capture the rejection AS A VALUE inside act() so the internal reload's
    // state updates settle within act (rethrowing straight out of act trips
    // React's "not configured to support act(...)" guard). The lightbox keeps
    // itself open on failure, so `onEdit` must still reject.
    let caught: unknown;
    await act(async () => {
        caught = await mockCaptured.userStoryEditProps
            ?.onEdit(makeUs({ id: 1000 }), {
                subject: "Conflicting",
                status: 101,
                points: {},
                assigned_to: null,
                description: "",
                tags: [],
                due_date: null,
                is_blocked: false,
                blocked_note: "",
                team_requirement: false,
                client_requirement: false,
                attachmentsToDelete: [],
                swimlane: null,
                attachmentsToAdd: [],
            })
            .then(() => undefined)
            .catch((err: unknown) => err);
    });
    expect(caught).toBeInstanceOf(HttpError);

    // A version conflict triggers a fresh backlog re-read to pick up newer versions.
    await waitFor(() =>
        expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore),
    );
});

/* ========================================================================== */
/* [M-10] Generic-form secondary fields: extended PATCH + attachment side-     */
/* effects. These prove the persistence contract the mocked lightbox delegates */
/* to BacklogApp (the DOM behaviour of the form itself lives in the sibling    */
/* UserStoryEditLightbox spec). The `attachments` API is deliberately NOT      */
/* mocked, so it runs for real over the mocked httpClient — letting us assert  */
/* the exact multipart FormData and DELETE endpoint the legacy form used.      */
/* ========================================================================== */

describe("BacklogApp — user-story form persistence (M-10)", () => {
    test("onCreate persists the secondary fields via a follow-up PATCH and uploads chosen files", async () => {
        await renderApp();
        mockBulkCreate.mockImplementationOnce(() =>
            Promise.resolve(mkRes([makeUs({ id: 2000, subject: "Rich US", version: 1 })])),
        );
        const file = new File(["data"], "attach.png", { type: "image/png" });

        await act(async () => {
            await mockCaptured.userStoryEditProps?.onCreate({
                subject: "Rich US",
                statusId: 1,
                points: {},
                assignedTo: null,
                position: "bottom",
                description: "the description",
                tags: [],
                due_date: null,
                is_blocked: false,
                blocked_note: "",
                team_requirement: true,
                client_requirement: false,
                swimlane: null,
                attachmentsToAdd: [file],
            });
        });

        // The follow-up PATCH carries the extended generic-form field set,
        // targeting the freshly-created story with its version.
        await waitFor(() =>
            expect(mockHttpPatch).toHaveBeenCalledWith(
                "userstories/2000",
                expect.objectContaining({
                    description: "the description",
                    team_requirement: true,
                    tags: [],
                    version: 1,
                }),
            ),
        );
        // The chosen file is uploaded as an attachment of the CREATED story via a
        // multipart POST to the frozen `/userstories/attachments` endpoint.
        const attachCall = mockHttpPost.mock.calls.find(
            (c) => c[0] === "/userstories/attachments",
        ) as unknown[] | undefined;
        expect(attachCall).toBeTruthy();
        const fd = attachCall?.[1] as FormData;
        expect(fd.get("object_id")).toBe("2000");
        expect(fd.get("project")).toBe(String(PROJECT_ID));
        expect((fd.get("attached_file") as File).name).toBe("attach.png");
    });

    test("a subject-only create makes NO follow-up PATCH and uploads nothing", async () => {
        await renderApp();
        mockBulkCreate.mockImplementationOnce(() =>
            Promise.resolve(mkRes([makeUs({ id: 2100, subject: "Bare", version: 1 })])),
        );

        await act(async () => {
            await mockCaptured.userStoryEditProps?.onCreate({
                subject: "Bare",
                statusId: 1,
                points: {},
                assignedTo: null,
                position: "bottom",
                description: "",
                tags: [],
                due_date: null,
                is_blocked: false,
                blocked_note: "",
                team_requirement: false,
                client_requirement: false,
                swimlane: null,
                attachmentsToAdd: [],
            });
        });

        // Every secondary field is at its create default => no follow-up PATCH.
        expect(mockHttpPatch).not.toHaveBeenCalled();
        // No files queued => nothing is uploaded.
        expect(
            mockHttpPost.mock.calls.some((c) => c[0] === "/userstories/attachments"),
        ).toBe(false);
    });

    test("onEdit persists the extended field set, deletes removed attachments, and uploads new ones", async () => {
        await renderApp();
        const file = new File(["data"], "fresh.png", { type: "image/png" });

        await act(async () => {
            await mockCaptured.userStoryEditProps?.onEdit(
                makeUs({ id: 1000, version: 9 }),
                {
                    subject: "Edited",
                    status: 101,
                    points: {},
                    assigned_to: null,
                    description: "updated body",
                    tags: [],
                    due_date: null,
                    is_blocked: false,
                    blocked_note: "",
                    team_requirement: false,
                    client_requirement: false,
                    attachmentsToDelete: [55],
                    swimlane: null,
                    attachmentsToAdd: [file],
                },
            );
        });

        // The edit PATCH carries the extended field set + optimistic version.
        await waitFor(() =>
            expect(mockHttpPatch).toHaveBeenCalledWith(
                "userstories/1000",
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
        expect(fd.get("object_id")).toBe("1000");
        expect((fd.get("attached_file") as File).name).toBe("fresh.png");
    });
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

test("onChanged closes the sprint lightbox and reloads open + closed sprints + stats + backlog", async () => {
    await renderApp();

    // Open it first so the close is observable.
    await act(async () => {
        mockCaptured.sprintListProps?.onAddNewSprint();
    });
    await waitFor(() => expect(mockCaptured.sprintEditProps?.open).toBe(true));

    const statsBefore = countGet((p) => p.includes("/stats"));
    const usBefore = countGet((p) => p === "userstories");

    await act(async () => {
        await mockCaptured.sprintEditProps?.onChanged();
    });

    await waitFor(() => expect(mockCaptured.sprintEditProps?.open).toBe(false));
    expect(mockListMilestones).toHaveBeenCalledWith(PROJECT_ID, { closed: true });
    expect(countGet((p) => p.includes("/stats"))).toBeGreaterThan(statsBefore);
    // [#5] The unified sprint-change handler MUST also reload the backlog list:
    // deleting a sprint SET_NULLs its stories' milestone, returning them to the
    // backlog, so the list has to be re-read or the returned stories never
    // reappear without a full page reload.
    expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore);
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

/**
 * Expand the collapsible filter category whose header title matches `title`
 * (QA finding [L]: categories start collapsed, one open at a time). Returns the
 * category `<li>` so callers can query its now-visible option list.
 */
async function expandCategory(container: HTMLElement, title: string): Promise<HTMLElement> {
    const header = Array.from(
        container.querySelectorAll(".filters-cat-single"),
    ).find((el) => el.querySelector(".title")?.textContent === title) as HTMLElement;
    await act(async () => {
        fireEvent.click(header);
    });
    return header.closest("li") as HTMLElement;
}

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
    // The Status + Tags categories were built (one collapsible header each), and
    // [L] every category starts collapsed (no option list rendered yet).
    expect(container.querySelectorAll(".filters-cat-single").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".filter-list")).toBeNull();
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

    // [L] Expand the Status category, then pick the option.
    await expandCategory(container, "Status");
    await act(async () => {
        fireEvent.click(container.querySelector(".single-filter") as HTMLElement);
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

    // Expand + add, then remove via the applied-filter chip's remove button. The
    // chip appears in the "included" group (QA finding [K]).
    await expandCategory(container, "Status");
    await act(async () => {
        fireEvent.click(container.querySelector(".single-filter") as HTMLElement);
    });
    await waitFor(() =>
        expect(
            container.querySelector(".filters-applied .filters-included .single-applied-filter"),
        ).not.toBeNull(),
    );

    await act(async () => {
        fireEvent.click(
            container.querySelector(
                ".filters-applied .single-applied-filter .remove-filter",
            ) as HTMLElement,
        );
    });

    await waitFor(() =>
        expect(container.querySelector(".filters-applied")).toBeNull(),
    );
});

test("typing in the search box debounces a reset reload carrying q", async () => {
    const { container } = await renderApp();
    const input = container.querySelector(
        "tg-input-search input.backlog-search",
    ) as HTMLInputElement;

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
    expect(window.localStorage.getItem(SHOW_TAGS_KEY)).toBe("false");
});

test("restores the persisted show-tags preference on load", async () => {
    // Persisted OFF while the hook default is ON -> the load path must flip it.
    window.localStorage.setItem(SHOW_TAGS_KEY, "false");
    const { container } = await renderApp();

    await waitFor(() =>
        expect(
            (container.querySelector("#show-tags-input") as HTMLInputElement).checked,
        ).toBe(false),
    );
});

test("[N-01] migrates a show-tags value from the pre-hash approximated key", async () => {
    // A value saved by the pre-N-01 build under the approximated key
    // (`showTags-${projectId}`) must still be honored, and copied forward
    // under the exact legacy hashed key so it round-trips thereafter.
    const approxKey = `showTags-${PROJECT_ID}`;
    window.localStorage.setItem(approxKey, "false");
    // The exact hashed key is intentionally absent to force the migration path.
    expect(window.localStorage.getItem(SHOW_TAGS_KEY)).toBeNull();

    const { container } = await renderApp();

    // The persisted OFF preference is honored despite living under the old key.
    await waitFor(() =>
        expect(
            (container.querySelector("#show-tags-input") as HTMLInputElement).checked,
        ).toBe(false),
    );
    // ...and the value has been copied forward under the exact hashed key.
    expect(window.localStorage.getItem(SHOW_TAGS_KEY)).toBe("false");
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
        expect(window.localStorage.getItem(BURNDOWN_COLLAPSED_KEY_EXACT)).toBe("true"),
    );
    expect(mockCaptured.burndownProps?.collapsed).toBe(true);
});

test("[N-01] migrates a burndown-collapsed value from the pre-hash approximated key", async () => {
    // The pre-N-01 build persisted this preference under the raw hash-input
    // string (`is-burndown-grpahs-collapsed`) rather than its sha1 hash. That
    // value must still be honored on load and copied forward under the exact key.
    window.localStorage.setItem("is-burndown-grpahs-collapsed", "true");
    expect(window.localStorage.getItem(BURNDOWN_COLLAPSED_KEY_EXACT)).toBeNull();

    await renderApp();

    // The collapsed preference is honored via the migration path...
    await waitFor(() => expect(mockCaptured.burndownProps?.collapsed).toBe(true));
    // ...and copied forward under the exact legacy hashed key.
    expect(window.localStorage.getItem(BURNDOWN_COLLAPSED_KEY_EXACT)).toBe("true");
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

test("[#4] a successful move-to-sprint clears the checkbox selection", async () => {
    const { container } = await renderApp();

    // Select the loaded story so the move affordance is revealed.
    await act(async () => {
        mockCaptured.backlogTableProps?.onToggleSelection(1, true, false);
    });
    expect(container.querySelector("#move-to-latest-sprint")).toHaveStyle({ display: "flex" });
    expect(
        Object.values(mockCaptured.backlogTableProps?.selectedRefs ?? {}).filter(Boolean).length,
    ).toBe(1);

    await act(async () => {
        fireEvent.click(container.querySelector("#move-to-latest-sprint") as HTMLElement);
        await Promise.resolve();
    });

    // The move persists ...
    await waitFor(() => expect(mockBulkUpdateMilestone).toHaveBeenCalled());
    // ... and the selection is cleared: the moved rows have left the backlog, so
    // the checkbox state (QA #4) must reset — the "N selected" move button hides
    // again and no ref remains checked. Previously the checked refs lingered,
    // leaving orphaned selection UI for rows no longer in the backlog list.
    await waitFor(() =>
        expect(
            Object.values(mockCaptured.backlogTableProps?.selectedRefs ?? {}).filter(Boolean)
                .length,
        ).toBe(0),
    );
    expect(container.querySelector("#move-to-latest-sprint")).toHaveStyle({ display: "none" });
});

test("move-to-sprint is a no-op when no rows are checked", async () => {
    const { container } = await renderApp();

    await act(async () => {
        fireEvent.click(container.querySelector("#move-to-latest-sprint") as HTMLElement);
        await Promise.resolve();
    });

    expect(mockBulkUpdateMilestone).not.toHaveBeenCalled();
});

test("[M] reveals the move-to-sprint button (display:flex) only once a row is checked", async () => {
    // Default fixtures: one story (ref 1) + one open (past) sprint -> the
    // move-to-latest variant is the one rendered.
    const { container } = await renderApp();

    // `.btn-filter.move-to-sprint` has a hard `display:none` base in the compiled
    // CSS; with nothing selected the button must carry an inline `display:none`.
    const before = container.querySelector("#move-to-latest-sprint") as HTMLElement;
    expect(before).not.toBeNull();
    expect(before).toHaveStyle({ display: "none" });

    // Checking a story flips the inline display to flex — this mirrors the
    // AngularJS `checkSelected()` `moveToSprintDom.css('display','flex')` behavior,
    // gated on there being at least one open sprint to move into.
    await act(async () => {
        mockCaptured.backlogTableProps?.onToggleSelection(1, true, false);
    });
    expect(container.querySelector("#move-to-latest-sprint")).toHaveStyle({ display: "flex" });

    // Unchecking hides it again.
    await act(async () => {
        mockCaptured.backlogTableProps?.onToggleSelection(1, false, false);
    });
    expect(container.querySelector("#move-to-latest-sprint")).toHaveStyle({ display: "none" });
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

test("[N] a same-container DOWNWARD drop over the adjacent row moves down ONE slot (not a no-op)", async () => {
    // Regression guard for the single-step keyboard/pointer reorder fix. Dragging
    // the FIRST row (1000, index 0) DOWN over the immediately-following row
    // (2000, index 1) previously no-oped: filtering 1000 out of the id list
    // shifted 2000 to index 0, so "insert before 2000" resolved back to the
    // drag's original slot. The fix lands the item AFTER the over-row for
    // downward same-container moves (canonical dnd-kit arrayMove semantics).
    currentUserstories = [
        makeUs({ id: 1000, ref: 1 }),
        makeUs({ id: 2000, ref: 2 }),
        makeUs({ id: 3000, ref: 3 }),
    ];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "3" };
    await renderApp();
    const resolve = mockCaptured.dndProps?.resolveDrop;

    const resolved = resolve?.(dragEnd(1000, 2000)) ?? null;
    // A genuine move (NOT null / no-op).
    expect(resolved).not.toBeNull();
    expect(resolved?.origin.containerKey).toBe("backlog");
    expect(resolved?.target.containerKey).toBe("backlog");
    // 1000 landed immediately AFTER 2000 — exactly one slot down.
    expect(resolved?.orderedIds).toEqual([2000, 1000, 3000]);
    expect(resolved?.target.index).toBe(1);
});

test("[N] a same-container DOWNWARD drop over a lower non-adjacent row lands AFTER it", async () => {
    // Dragging the first row (1000) DOWN over the LAST row (3000) lands 1000
    // after 3000 (i.e. at the end) — arrayMove(0 -> 2) semantics, one slot per
    // crossed row, symmetric with the pointer path.
    currentUserstories = [
        makeUs({ id: 1000, ref: 1 }),
        makeUs({ id: 2000, ref: 2 }),
        makeUs({ id: 3000, ref: 3 }),
    ];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "3" };
    await renderApp();
    const resolve = mockCaptured.dndProps?.resolveDrop;

    const resolved = resolve?.(dragEnd(1000, 3000)) ?? null;
    expect(resolved).not.toBeNull();
    expect(resolved?.orderedIds).toEqual([2000, 3000, 1000]);
    expect(resolved?.target.index).toBe(2);
});

test("[N] downward single-step persists after=<over-row>, before=null via the backlog order endpoint", async () => {
    // End-to-end: a single-ArrowDown reorder (1000 over 2000) must PERSIST with
    // the correct neighbor mapping (previous -> afterUserstoryId). Before the fix
    // no request fired at all because the drop resolved to a no-op.
    currentUserstories = [
        makeUs({ id: 1000, ref: 1 }),
        makeUs({ id: 2000, ref: 2 }),
        makeUs({ id: 3000, ref: 3 }),
    ];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "3" };
    await renderApp();
    const dnd = mockCaptured.dndProps;
    const resolved = dnd?.resolveDrop(dragEnd(1000, 2000)) ?? null;
    expect(resolved).not.toBeNull();

    // Neighbors the provider derives for target.index === 1 in [2000,1000,3000]:
    // previous (scanning back) = 2000, next = null.
    await act(async () => {
        await dnd?.persist(resolved as ResolvedDrop, { previous: 2000, next: null });
    });

    expect(mockPersister).toHaveBeenCalledWith({
        milestoneId: null,
        afterUserstoryId: 2000,
        beforeUserstoryId: null,
        bulkUserstories: [1000],
    });
});

/* -------------------------------------------------------------------------- *
 * Multi-select drag (legacy `window.dragMultiple` parity)                     *
 * -------------------------------------------------------------------------- */

test("[multi] resolveDrop moves the whole checked selection as a block when a SELECTED row is dragged", async () => {
    currentUserstories = [
        makeUs({ id: 1000, ref: 1 }),
        makeUs({ id: 2000, ref: 2 }),
        makeUs({ id: 3000, ref: 3 }),
    ];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "3" };
    await renderApp();

    // Check the last two rows (selection is keyed by us.ref).
    await act(async () => {
        mockCaptured.backlogTableProps?.onToggleSelection(2, true, false);
        mockCaptured.backlogTableProps?.onToggleSelection(3, true, false);
    });

    // Drag the SELECTED row 2000 over row 1000 → BOTH checked stories move as a
    // block, in origin order [2000, 3000], landing at the front (mirrors the
    // legacy `reorder multiple us` expectation: rows[0]=count-2, rows[1]=count-1).
    const resolved = mockCaptured.dndProps?.resolveDrop(dragEnd(2000, 1000)) ?? null;
    expect(resolved).not.toBeNull();
    expect(resolved?.draggedIds).toEqual([2000, 3000]);
    expect(resolved?.orderedIds).toEqual([2000, 3000, 1000]);
    expect(resolved?.target.index).toBe(0);
});

test("[multi] dragging an UNCHECKED row ignores the selection (single-item move)", async () => {
    currentUserstories = [
        makeUs({ id: 1000, ref: 1 }),
        makeUs({ id: 2000, ref: 2 }),
        makeUs({ id: 3000, ref: 3 }),
    ];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "3" };
    await renderApp();

    await act(async () => {
        mockCaptured.backlogTableProps?.onToggleSelection(2, true, false);
        mockCaptured.backlogTableProps?.onToggleSelection(3, true, false);
    });

    // Legacy `isMultiple` requires the DRAGGED row itself to be checked; dragging
    // the unchecked row 1000 moves only 1000.
    const resolved = mockCaptured.dndProps?.resolveDrop(dragEnd(1000, 3000)) ?? null;
    expect(resolved?.draggedIds).toEqual([1000]);
});

test("[multi] persist moves the whole selection into a sprint via ONE bulk call and clears the selection", async () => {
    currentOpenSprints = [makeSprint({ id: 10, user_stories: [] })];
    currentUserstories = [
        makeUs({ id: 1000, ref: 1 }),
        makeUs({ id: 2000, ref: 2 }),
        makeUs({ id: 3000, ref: 3 }),
    ];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "3" };
    await renderApp();

    await act(async () => {
        mockCaptured.backlogTableProps?.onToggleSelection(2, true, false);
        mockCaptured.backlogTableProps?.onToggleSelection(3, true, false);
    });

    const dnd = mockCaptured.dndProps;
    const resolved = dnd?.resolveDrop(dragEnd(2000, "sprint:10")) ?? null;
    expect(resolved?.draggedIds).toEqual([2000, 3000]);
    expect(resolved?.target.containerKey).toBe("sprint:10");

    await act(async () => {
        await dnd?.persist(resolved as ResolvedDrop, { previous: null, next: null });
    });

    // ONE bulk request carries BOTH dragged ids.
    expect(mockPersister).toHaveBeenCalledWith(
        expect.objectContaining({ bulkUserstories: [2000, 3000] }),
    );
    // Optimistic move relocated both out of the backlog (backlog is not reloaded).
    await waitFor(() => {
        const ids = mockCaptured.backlogTableProps?.userstories.map((u) => u.id) ?? [];
        expect(ids).toEqual([1000]);
    });
    // The multi-select was cleared after the bulk drag.
    await waitFor(() =>
        expect(
            Object.values(mockCaptured.backlogTableProps?.selectedRefs ?? {}).some(Boolean),
        ).toBe(false),
    );
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

    // All six category headers present (one collapsible `.filters-cat-single` each).
    expect(container.querySelectorAll(".filters-cat-single").length).toBe(6);
    const titles = Array.from(container.querySelectorAll(".filters-cat-single .title")).map(
        (el) => el.textContent,
    );
    expect(titles).toEqual(["Status", "Tags", "Assigned to", "Role", "Created by", "Epic"]);

    // [L] Expand each relevant category to inspect its built options:
    // null-id assignee/role -> "Unassigned"; epic without id -> "Not in an epic".
    const assigned = await expandCategory(container, "Assigned to");
    expect(assigned.textContent).toContain("Unassigned");
    const role = await expandCategory(container, "Role");
    expect(role.textContent).toContain("Unassigned");
    const createdBy = await expandCategory(container, "Created by");
    expect(createdBy.textContent).toContain("Bob");
    const epic = await expandCategory(container, "Epic");
    expect(epic.textContent).toContain("Not in an epic");
    expect(epic.textContent).toContain("#12 Epic A");
});

/* -------------------------------------------------------------------------- */
/* [L] Collapsible categories — single-open accordion                          */
/* -------------------------------------------------------------------------- */

test("[L] filter categories are a single-open accordion (opening one collapses the previous)", async () => {
    currentFiltersData = {
        statuses: [{ id: 7, name: "In progress", color: "#00f", count: 3 }],
        tags: [{ name: "urgent", color: "#f00", count: 1 }],
    };
    const { container } = await renderApp();
    await act(async () => {
        fireEvent.click(container.querySelector("#show-filters-button") as HTMLElement);
    });
    await waitFor(() => expect(container.querySelector("#backlog-filter")).not.toBeNull());

    // Every category starts collapsed (FilterController.opened = null).
    expect(container.querySelector(".filter-list")).toBeNull();

    // Open Status → exactly one option list renders, under Status.
    const statusLi = await expandCategory(container, "Status");
    expect(statusLi.querySelector(".filter-list")).not.toBeNull();
    expect(container.querySelectorAll(".filter-list").length).toBe(1);

    // Open Tags → Status collapses (single-open), Tags now carries the list.
    const tagsLi = await expandCategory(container, "Tags");
    expect(tagsLi.querySelector(".filter-list")).not.toBeNull();
    expect(statusLi.querySelector(".filter-list")).toBeNull();
    expect(container.querySelectorAll(".filter-list").length).toBe(1);

    // Re-click Tags → fully collapsed again.
    await expandCategory(container, "Tags");
    expect(container.querySelector(".filter-list")).toBeNull();
});

/* -------------------------------------------------------------------------- */
/* [K] Include / Exclude mode                                                  */
/* -------------------------------------------------------------------------- */

test("[K] selecting a filter in Exclude mode builds an exclude_ query param and an 'Excluded' chip", async () => {
    currentFiltersData = {
        statuses: [{ id: 7, name: "In progress", color: "#00f", count: 3 }],
    };
    const { container } = await renderApp();
    await act(async () => {
        fireEvent.click(container.querySelector("#show-filters-button") as HTMLElement);
    });
    await waitFor(() => expect(container.querySelector("#backlog-filter")).not.toBeNull());

    // Switch to Exclude mode (QA finding [K]: React previously offered include only).
    await act(async () => {
        fireEvent.click(container.querySelector("#filter-mode-exclude") as HTMLElement);
    });

    // Expand Status + pick the option.
    await expandCategory(container, "Status");
    await act(async () => {
        fireEvent.click(container.querySelector(".single-filter") as HTMLElement);
    });

    // The reload carried `exclude_status=7` (NOT the plain `status` key).
    await waitFor(() =>
        expect(
            mockHttpGet.mock.calls.some(
                (c) =>
                    String(c[0]) === "userstories" &&
                    (c[1] as Record<string, unknown>)?.exclude_status === "7",
            ),
        ).toBe(true),
    );
    expect(
        mockHttpGet.mock.calls.some(
            (c) =>
                String(c[0]) === "userstories" &&
                (c[1] as Record<string, unknown>)?.status !== undefined,
        ),
    ).toBe(false);

    // The applied chip appears in the "Excluded" group, not the "included" group.
    await waitFor(() =>
        expect(
            container.querySelector(
                ".filters-applied .filters-excluded .single-applied-filter",
            ),
        ).not.toBeNull(),
    );
    expect(container.querySelector(".filters-applied .filters-included")).toBeNull();
});

/* -------------------------------------------------------------------------- */
/* [J] Custom (saved) filters — save / apply / delete via /user-storage        */
/* -------------------------------------------------------------------------- */

test("[J] saving a custom filter PUTs the selection to /user-storage and lists it", async () => {
    currentFiltersData = {
        statuses: [{ id: 7, name: "In progress", color: "#00f", count: 3 }],
    };
    const { container } = await renderApp();
    await act(async () => {
        fireEvent.click(container.querySelector("#show-filters-button") as HTMLElement);
    });
    await waitFor(() => expect(container.querySelector("#backlog-filter")).not.toBeNull());

    // "Add" is disabled until something is selected.
    expect(
        (container.querySelector(".add-custom-filter") as HTMLButtonElement).disabled,
    ).toBe(true);

    // Select a Status filter, then the Add affordance enables.
    await expandCategory(container, "Status");
    await act(async () => {
        fireEvent.click(container.querySelector(".single-filter") as HTMLElement);
    });
    await waitFor(() =>
        expect(
            (container.querySelector(".add-custom-filter") as HTMLButtonElement).disabled,
        ).toBe(false),
    );

    // Open the name form, type a name, submit.
    await act(async () => {
        fireEvent.click(container.querySelector(".add-custom-filter") as HTMLElement);
    });
    const input = container.querySelector(".e2e-filter-name-input") as HTMLInputElement;
    await act(async () => {
        fireEvent.change(input, { target: { value: "My work" } });
    });
    await act(async () => {
        fireEvent.submit(container.querySelector(".custom-filters-add-form") as HTMLElement);
    });

    // storeFilters PUT the whole map to /user-storage/{hash} with the selection.
    const hash = storageHash(PROJECT_ID, "backlog-custom-filters");
    await waitFor(() =>
        expect(
            mockHttpPut.mock.calls.some((c) => String(c[0]) === `user-storage/${hash}`),
        ).toBe(true),
    );
    const putCall = mockHttpPut.mock.calls.find(
        (c) => String(c[0]) === `user-storage/${hash}`,
    );
    expect(putCall?.[1]).toEqual({ key: hash, value: { "My work": { status: "7" } } });

    // The saved filter is now listed under "Custom filters".
    await waitFor(() =>
        expect(container.querySelector(".single-filter-type-custom")).not.toBeNull(),
    );
    expect(container.querySelector(".custom-filter-list")?.textContent).toContain("My work");
});

test("[J] rejects a blank or duplicate custom-filter name without persisting", async () => {
    currentFiltersData = {
        statuses: [{ id: 7, name: "In progress", color: "#00f", count: 3 }],
    };
    const { container } = await renderApp();
    await act(async () => {
        fireEvent.click(container.querySelector("#show-filters-button") as HTMLElement);
    });
    await waitFor(() => expect(container.querySelector("#backlog-filter")).not.toBeNull());

    await expandCategory(container, "Status");
    await act(async () => {
        fireEvent.click(container.querySelector(".single-filter") as HTMLElement);
    });
    await waitFor(() =>
        expect(
            (container.querySelector(".add-custom-filter") as HTMLButtonElement).disabled,
        ).toBe(false),
    );
    await act(async () => {
        fireEvent.click(container.querySelector(".add-custom-filter") as HTMLElement);
    });

    // Submit with an empty name → length-zero error, nothing persisted.
    await act(async () => {
        fireEvent.submit(container.querySelector(".custom-filters-add-form") as HTMLElement);
    });
    expect(container.querySelector(".error-text")?.textContent).toContain(
        "Please add a filter name",
    );
    expect(mockHttpPut).not.toHaveBeenCalled();
    expect(mockHttpPost).not.toHaveBeenCalled();
});

test("[J] applying a saved custom filter reconstructs the selection and reloads", async () => {
    currentFiltersData = {
        statuses: [{ id: 7, name: "In progress", color: "#00f", count: 3 }],
    };
    const hash = storageHash(PROJECT_ID, "backlog-custom-filters");
    // A previously-saved filter already lives in /user-storage.
    mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
        const path = String(args[0]);
        if (path.includes("/stats")) return Promise.resolve(mkRes(currentStats));
        if (path === `projects/${PROJECT_ID}`) return Promise.resolve(mkRes(currentProject));
        if (path === "projects/by_slug") return Promise.resolve(mkRes(currentProject));
        if (path === "userstories") {
            return Promise.resolve(mkRes(currentUserstories, currentUsHeaders));
        }
        if (path === `user-storage/${hash}`) {
            return Promise.resolve(mkRes({ key: hash, value: { Saved: { status: "7" } } }));
        }
        return Promise.resolve(mkRes({}));
    });

    const { container } = await renderApp();
    await act(async () => {
        fireEvent.click(container.querySelector("#show-filters-button") as HTMLElement);
    });
    await waitFor(() => expect(container.querySelector("#backlog-filter")).not.toBeNull());

    // The saved filter is listed on load.
    await waitFor(() =>
        expect(container.querySelector(".single-filter-type-custom .name")).not.toBeNull(),
    );
    const usBefore = countGet((p) => p === "userstories");

    // Apply it.
    await act(async () => {
        fireEvent.click(
            container.querySelector(".single-filter-type-custom .name") as HTMLElement,
        );
    });

    // A fresh reload carried status=7, and the custom filter is marked active.
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
        expect(container.querySelector(".single-filter-type-custom.active")).not.toBeNull(),
    );
    expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore);
});

test("[J] removing a saved custom filter DELETEs the row once it becomes empty", async () => {
    currentFiltersData = {
        statuses: [{ id: 7, name: "In progress", color: "#00f", count: 3 }],
    };
    const hash = storageHash(PROJECT_ID, "backlog-custom-filters");
    mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
        const path = String(args[0]);
        if (path.includes("/stats")) return Promise.resolve(mkRes(currentStats));
        if (path === `projects/${PROJECT_ID}`) return Promise.resolve(mkRes(currentProject));
        if (path === "projects/by_slug") return Promise.resolve(mkRes(currentProject));
        if (path === "userstories") {
            return Promise.resolve(mkRes(currentUserstories, currentUsHeaders));
        }
        if (path === `user-storage/${hash}`) {
            return Promise.resolve(mkRes({ key: hash, value: { Saved: { status: "7" } } }));
        }
        return Promise.resolve(mkRes({}));
    });

    const { container } = await renderApp();
    await act(async () => {
        fireEvent.click(container.querySelector("#show-filters-button") as HTMLElement);
    });
    await waitFor(() => expect(container.querySelector("#backlog-filter")).not.toBeNull());
    await waitFor(() =>
        expect(container.querySelector(".e2e-remove-custom-filter")).not.toBeNull(),
    );

    // Remove the only saved filter.
    await act(async () => {
        fireEvent.click(container.querySelector(".e2e-remove-custom-filter") as HTMLElement);
    });

    // The stored map became empty → storeFilters issued a DELETE on the row hash.
    await waitFor(() =>
        expect(
            mockHttpDelete.mock.calls.some((c) => String(c[0]) === `user-storage/${hash}`),
        ).toBe(true),
    );
    // And it disappears from the panel.
    await waitFor(() =>
        expect(container.querySelector(".single-filter-type-custom")).toBeNull(),
    );
});

/* -------------------------------------------------------------------------- */
/* [I] No-results copy interpolates the search term                            */
/* -------------------------------------------------------------------------- */

test("[I] the no-results state interpolates the search term with curly quotes", async () => {
    // Empty backlog + a search term → the empty-backlog (no-match) block shows.
    currentUserstories = [];
    currentUsHeaders = { "Taiga-Info-Backlog-Total-Userstories": "0" };
    const { container } = await renderApp();

    const input = container.querySelector(
        "tg-input-search input.backlog-search",
    ) as HTMLInputElement;
    await act(async () => {
        fireEvent.change(input, { target: { value: "zzz" } });
    });

    // The block becomes visible (not `.hidden`) and interpolates the term.
    await waitFor(() => {
        const box = container.querySelector(".empty-backlog") as HTMLElement;
        expect(box.className).not.toContain("hidden");
    });
    const noMatch = container.querySelector(".no-match") as HTMLElement;
    expect(noMatch.textContent).toBe(
        "No matching search result found with \u201Czzz\u201D",
    );
    expect(container.querySelector(".no-match-help")?.textContent).toContain(
        "Try again using more general search terms",
    );
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

    // The reload is debounced (pure-trailing, EVENTS_DEBOUNCE_MS): both the
    // userstories refetch and the sprint reload fire together on the trailing
    // edge, so poll past the debounce window for both.
    await waitFor(
        () => {
            expect(countGet((p) => p === "userstories")).toBeGreaterThan(usBefore);
            expect(mockListMilestones.mock.calls.length).toBeGreaterThan(
                sprintsBefore,
            );
        },
        { timeout: WS_REFRESH_TIMEOUT },
    );
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

    // The reload is debounced (pure-trailing, EVENTS_DEBOUNCE_MS): the closed-
    // sprint reload and the project-stats refetch fire together on the trailing
    // edge, so poll past the debounce window for both.
    await waitFor(
        () => {
            expect(mockListMilestones).toHaveBeenCalledWith(PROJECT_ID, {
                closed: true,
            });
            expect(countGet((p) => p.includes("/stats"))).toBeGreaterThan(
                statsBefore,
            );
        },
        { timeout: WS_REFRESH_TIMEOUT },
    );
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

    // [#2] Its create button opens the React create lightbox (standard add),
    // leaving the bulk lightbox closed.
    await act(async () => {
        fireEvent.click(container.querySelector(".empty-large .btn-small") as HTMLElement);
    });
    expect(mockCaptured.userStoryEditProps?.open).toBe(true);
    expect(mockCaptured.userStoryEditProps?.mode).toBe("create");
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

test("onChangeStatus reports (does not reload) on a non-conflict failure (HTTP 500)", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderApp();
    // A generic 500 is NOT a version conflict, so isVersionConflict is false and
    // the handler reports the error instead of reloading.
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

test("onChangePoints reloads the backlog on a version conflict (HTTP 400 + version body)", async () => {
    await renderApp();
    // [W1-1] The FROZEN backend signals an OCC version conflict as HTTP 400 with
    // a {"version": "..."} body (WrongArguments -> BadRequest), NOT 409.
    mockHttpPatch.mockImplementation(() =>
        Promise.reject(
            new HttpError(
                400,
                "Bad Request",
                { version: "The version doesn't match with the current one" },
                "userstories/1000",
            ),
        ),
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

test("[M-04] a stale userstories response never overwrites a newer query (latest-wins)", async () => {
    // Enable pagination so onLoadMore issues real follow-up userstories loads.
    currentUsHeaders = {
        "x-pagination-next": "1",
        "Taiga-Info-Backlog-Total-Userstories": "3",
    };
    await renderApp();

    // Replace the userstories route with two CONTROLLABLE responses so their
    // completion order can be inverted relative to their request order.
    const resolvers: Array<() => void> = [];
    let usCall = 0;
    mockHttpGet.mockImplementation((...args: readonly unknown[]) => {
        const path = String(args[0]);
        if (path.includes("/stats")) return Promise.resolve(mkRes(currentStats));
        if (path === `projects/${PROJECT_ID}`) return Promise.resolve(mkRes(currentProject));
        if (path === "projects/by_slug") return Promise.resolve(mkRes(currentProject));
        if (path === "userstories") {
            usCall += 1;
            const which = usCall;
            return new Promise((resolve) => {
                resolvers.push(() =>
                    resolve(
                        mkRes(
                            which === 1
                                ? [makeUs({ id: 111, ref: 11, subject: "STALE", backlog_order: 3 })]
                                : [makeUs({ id: 222, ref: 22, subject: "FRESH", backlog_order: 2 })],
                            {},
                        ),
                    ),
                );
            });
        }
        return Promise.resolve(mkRes({}));
    });

    // Fire two overlapping follow-up loads (request order: #1 then #2).
    await act(async () => {
        mockCaptured.backlogTableProps?.onLoadMore();
        mockCaptured.backlogTableProps?.onLoadMore();
        await Promise.resolve();
    });
    expect(resolvers.length).toBe(2);

    // Complete them OUT OF ORDER: the newer request (#2, FRESH) resolves first…
    await act(async () => {
        resolvers[1]();
        await Promise.resolve();
    });
    // …then the older request (#1, STALE) resolves last.
    await act(async () => {
        resolvers[0]();
        await Promise.resolve();
    });

    // The board committed only the FRESH query; the superseded STALE response
    // was dropped by the per-query generation guard.
    const ids = (mockCaptured.backlogTableProps?.userstories ?? []).map((u) => u.id);
    expect(ids).toContain(222);
    expect(ids).not.toContain(111);
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

/* ========================================================================== */
/* [ERR-1] — recoverable mutation failures surface a non-blocking toast        */
/* ========================================================================== */

test("[ERR-1] surfaces a non-blocking error toast when an inline status change fails", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = await renderApp();
    // A non-conflict server error (500): the handler rolls back and reports.
    mockHttpPatch.mockImplementation(() =>
        Promise.reject(new HttpError(500, "Server Error", null, "userstories/1000")),
    );

    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onChangeStatus(makeUs({ id: 1000 }), 9);
        await Promise.resolve();
    });

    // A themed, dismissible error banner is now shown to the user — no longer a
    // silent console-only failure.
    await waitFor(() => {
        expect(container.querySelector(".notification-message-error")).not.toBeNull();
    });
    expect(
        screen.getByText("Could not update the status. Please try again."),
    ).toBeInTheDocument();
    // The board itself is still rendered (non-blocking).
    expect(container.querySelector(".backlog")).not.toBeNull();
    errSpy.mockRestore();
});

test("[ERR-1] surfaces an error toast when a delete fails, and it can be dismissed", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = await renderApp();
    mockHttpDelete.mockImplementation(() =>
        Promise.reject(new HttpError(500, "Server Error", null, "userstories/1000")),
    );

    // [H] Confirm the themed delete dialog to trigger the (failing) DELETE.
    const dialog = document.querySelector.bind(document);
    await act(async () => {
        mockCaptured.backlogTableProps?.actions.onDeleteUserStory(makeUs({ id: 1000 }));
        await Promise.resolve();
    });
    await act(async () => {
        fireEvent.click(
            dialog(".lightbox-generic-delete.open .js-confirm") as HTMLElement,
        );
        await Promise.resolve();
    });

    await waitFor(() => {
        expect(
            screen.getByText("Could not delete the story. Please try again."),
        ).toBeInTheDocument();
    });

    // The user can dismiss it (non-blocking, self-clearing).
    await act(async () => {
        fireEvent.click(screen.getByLabelText("Close notification"));
    });
    expect(container.querySelector(".notification-message-error")).toBeNull();

    errSpy.mockRestore();
});

/* ========================================================================== */
/* [ERR-2] — interceptor side effects mapped onto full-page overlays           */
/* ========================================================================== */

test("[ERR-2] installs an offline hook that shows a full-page connection-error overlay", async () => {
    resetInterceptorHooks();
    clearNotificationListeners();
    const { container } = await renderApp();
    expect(container.querySelector(".backlog")).not.toBeNull();

    // Simulate the httpClient reporting an offline failure through the policy
    // BacklogApp installed on mount.
    await act(async () => {
        getInterceptorHooks().onOffline(new TypeError("Failed to fetch"));
    });

    await waitFor(() => expect(screen.getByText("Connection lost")).toBeInTheDocument());
    // The board is replaced by the full-page overlay (mirrors errorHandling.error()).
    expect(container.querySelector(".backlog")).toBeNull();
});

test("[ERR-2] installs a blocked hook that shows the permission-denied overlay on 451", async () => {
    resetInterceptorHooks();
    clearNotificationListeners();
    const { container } = await renderApp();
    expect(container.querySelector(".backlog")).not.toBeNull();

    await act(async () => {
        getInterceptorHooks().onBlocked();
    });

    await waitFor(() => expect(screen.getByText("Permission denied")).toBeInTheDocument());
    expect(container.querySelector(".backlog")).toBeNull();
});

test("[ERR-2] restores the DEFAULT interceptor policy when the Backlog root unmounts", async () => {
    resetInterceptorHooks();
    clearNotificationListeners();
    const { unmount } = await renderApp();

    // While mounted, the offline hook is BacklogApp's (drives the overlay).
    // After unmount it must revert to the default bus policy so a later screen
    // is not driven by a dead component's setState.
    unmount();

    // The default onOffline emits onto the shared bus and never throws.
    const received: string[] = [];
    const unsubscribe = subscribeNotifications((n) => received.push(n.message));

    expect(() => getInterceptorHooks().onOffline(new Error("x"))).not.toThrow();
    expect(received).toHaveLength(1);

    unsubscribe();
    resetInterceptorHooks();
});

/* ========================================================================== */
/* [F] Heading order + [B][C][E] copy strings                                 */
/* ========================================================================== */

describe("headings and copy strings", () => {
    test("[F] renders the 'Scrum' <h1> first, before the 'Backlog' <h2>", async () => {
        const { container } = await renderApp();
        const section = container.querySelector("section.backlog") as HTMLElement;

        const h1 = section.querySelector("header h1");
        expect(h1).not.toBeNull();
        expect(h1).toHaveTextContent("Scrum");

        // Heading order: the Scrum h1 precedes the Backlog h2 in DOM order.
        const headings = Array.from(section.querySelectorAll("h1, h2"));
        const scrumIdx = headings.findIndex((h) => h.textContent?.includes("Scrum"));
        const backlogIdx = headings.findIndex((h) => h.textContent?.includes("Backlog"));
        expect(scrumIdx).toBeGreaterThanOrEqual(0);
        expect(backlogIdx).toBeGreaterThan(scrumIdx);
    });

    test("[B] shows the unfiltered story count as '{n} user stories'", async () => {
        const { container } = await renderApp();
        const count = container.querySelector(
            ".backlog-header-title .backlog-stories-number",
        );
        expect(count).not.toBeNull();
        expect((count?.textContent ?? "").trim()).toMatch(/^\d+ user stories$/);
    });

    test("[E] labels the add controls: '+ user story' text and bulk-add aria-label", async () => {
        const { container } = await renderApp();

        const addText = container.querySelector(".new-us .text");
        expect(addText).toHaveTextContent("user story");

        const bulk = container.querySelector(
            '[aria-label="Add some new user stories in bulk"]',
        );
        expect(bulk).not.toBeNull();
        expect(bulk).toHaveAttribute("title", "Add some new user stories in bulk");
    });

    test("[C] shows the filtered count as 'of {n} user stories' when a filter is selected", async () => {
        currentFiltersData = {
            statuses: [{ id: 7, name: "In progress", color: "#00f", count: 3 }],
        };
        const { container } = await renderApp();

        await act(async () => {
            fireEvent.click(container.querySelector("#show-filters-button") as HTMLElement);
        });
        await waitFor(() =>
            expect(container.querySelector("#backlog-filter")).not.toBeNull(),
        );
        await expandCategory(container, "Status");
        await act(async () => {
            fireEvent.click(container.querySelector(".single-filter") as HTMLElement);
        });

        await waitFor(() =>
            expect(container.querySelector(".selected-filters")).not.toBeNull(),
        );

        const numbers = Array.from(
            container.querySelectorAll(".backlog-header-title .backlog-stories-number"),
        ).map((el) => (el.textContent ?? "").trim());
        expect(numbers.some((t) => /^of \d+ user stories$/.test(t))).toBe(true);
    });
});
