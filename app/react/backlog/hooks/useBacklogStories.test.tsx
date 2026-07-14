/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit / behaviour tests for {@link useBacklogStories}.
 *
 * The hook is the single owner of all Backlog / Sprint-Planning state and side
 * effects, so these tests drive it through `renderHook` while mocking only the
 * two impure cross-framework seams — the REST facade (`../../shared/api`) and
 * the WebSocket client (`../../shared/ws/events`). The pure immer state
 * producers in `../../shared/state` are exercised for real so the optimistic
 * drag / reorder / reconcile / per-op-rollback math is validated end-to-end.
 *
 * IMPORTANT (mock hygiene): the api module is mocked with a FACTORY that
 * preserves the real barrel and replaces ONLY `createApiClient`. A bare
 * `jest.mock("../../shared/api")` auto-mock would stub `sanitizeErrorMessage`
 * to `undefined`, silently breaking the user-visible error surface (M2) and
 * masking regressions — so the real `sanitizeErrorMessage` runs here.
 *
 * The screen loads the AUTHORITATIVE project + stats from the frozen REST
 * surface (C1/C5): `getProjectBySlug` (real my_permissions / activation /
 * statuses / members) and `getProjectStats` (real assigned_points / speed /
 * milestone totals). There is NO `window`-global project bridge and NO
 * fabricated read-only fallback: a rejected project load fails CLOSED.
 */

import { act, renderHook, waitFor } from "@testing-library/react";

import { useBacklogStories } from "./useBacklogStories";
import type { BacklogVM } from "./useBacklogStories";
import type { Milestone, MountContext, Project, UserStory } from "../../shared/types";
import type { ApiClient, ProjectStats } from "../../shared/api";
import type { EventsClient, ProjectEventHandlers } from "../../shared/ws/events";
import { createApiClient, ApiError } from "../../shared/api";
import { createEventsClient, subscribeToProject } from "../../shared/ws/events";
import { generateHash } from "../../shared/storage/legacyStorage";
import { createEmptyStoryValues, storyToFormValues } from "../../shared/lightboxes";

// FACTORY mock: keep the real barrel (so `sanitizeErrorMessage` is REAL) and
// override only the impure client factory.
jest.mock("../../shared/api", () => {
    const actual = jest.requireActual("../../shared/api");
    return { ...actual, createApiClient: jest.fn() };
});
jest.mock("../../shared/ws/events", () => ({
    createEventsClient: jest.fn(),
    subscribeToProject: jest.fn(),
}));

/* --------------------------------------------------------------------------- *
 * Fixtures
 * --------------------------------------------------------------------------- */

const context: MountContext = {
    projectSlug: "p1",
    token: "tok",
    sessionId: "sess",
    apiUrl: "http://localhost/api/v1/",
    eventsUrl: null,
    language: "en",
};

/** The legacy `showTags` storage key for project 7 (taiga.generateHash). */
const SHOW_TAGS_KEY_7 = generateHash([7, "7:backlog-tags"]);
/** The pre-migration React key that must NEVER be written (M5 regression guard). */
const LEGACY_REACT_VELOCITY_KEY = "taiga-react:backlog:7:displayVelocity";
const LEGACY_REACT_SHOWTAGS_KEY = "taiga-react:backlog:7:showTags";

/** The sanitized message the real `sanitizeErrorMessage` returns for a plain Error. */
const GENERIC_ERROR = "Something went wrong. Please try again.";

function us(id: number, over: Partial<UserStory> = {}): UserStory {
    return {
        id,
        status: 1,
        swimlane: null,
        backlog_order: id,
        sprint_order: id,
        milestone: null,
        project: 7,
        version: 1,
        subject: `US ${id}`,
        total_points: 1,
        points: {},
        ...over,
    } as UserStory;
}

function sprint(id: number, over: Partial<Milestone> = {}): Milestone {
    return {
        id,
        name: `Sprint ${id}`,
        estimated_start: "2000-01-01",
        estimated_finish: "2999-12-31",
        user_stories: [],
        total_points: 0,
        closed_points: 0,
        ...over,
    } as Milestone;
}

/**
 * The AUTHORITATIVE project payload (`GET /projects/by_slug`). This is the ONLY
 * source of project context — there is no `window` global bridge.
 */
function project(over: Record<string, unknown> = {}): Project {
    return {
        id: 7,
        slug: "p1",
        name: "Project One",
        my_permissions: ["view_us", "modify_us", "add_us", "add_milestone"],
        is_kanban_activated: true,
        is_backlog_activated: true,
        archived_code: null,
        us_statuses: [
            { id: 1, name: "New", order: 1 },
            { id: 2, name: "Done", order: 2 },
        ],
        points: [{ id: 1, value: 1 }],
        roles: [{ id: 3, name: "Dev", computable: true }],
        members: [{ id: 100, full_name: "Ann" }],
        default_swimlane: null,
        total_story_points: 10,
        total_milestones: 2,
        total_closed_milestones: 1,
        ...over,
    } as unknown as Project;
}

/**
 * The AUTHORITATIVE stats payload (`GET /projects/{id}/stats`). The REAL
 * `assigned_points` (60) is deliberately DIFFERENT from `closed_points` (40) and
 * `speed` (12.5) is non-zero — the previous derived stats hard-coded
 * `assigned_points = closed_points` and `speed = 0` (C5).
 */
function statsFixture(over: Partial<ProjectStats> = {}): ProjectStats {
    return {
        total_points: 100,
        defined_points: 100,
        closed_points: 40,
        assigned_points: 60,
        total_milestones: 2,
        total_userstories: 20,
        // `speed` + `milestones` reach the client via the ProjectStats index signature.
        speed: 12.5,
        // Authoritative per-sprint burndown series shape (taiga-back
        // stats.py `_get_milestones_stats_for_backlog`): each entry carries a
        // SCALAR optimal/evolution plus the two hyphenated increment fields;
        // `evolution` is null for a future sprint (exercises the null-skip path).
        milestones: [
            { name: "Sprint 4", optimal: 100, evolution: 100, "team-increment": 0, "client-increment": 0 },
            { name: "Sprint 5", optimal: 50, evolution: 60, "team-increment": 0, "client-increment": 0 },
            { name: "Future sprint", optimal: 0, evolution: null, "team-increment": 0, "client-increment": 0 },
        ],
        ...over,
    } as ProjectStats;
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
}

/**
 * Build an `UnassignedUserStoriesResult` (the M2 paginated shape) from a plain
 * story array. `backlogTotal` defaults to the array length; `hasNext` to false.
 */
function page(
    list: UserStory[],
    over: Partial<{ hasNext: boolean; backlogTotal: number | null; count: number; current: number; paginatedBy: number }> = {},
): { userStories: UserStory[]; count: number; current: number; paginatedBy: number; hasNext: boolean; backlogTotal: number | null } {
    return {
        userStories: list,
        count: over.count ?? list.length,
        current: over.current ?? 1,
        paginatedBy: over.paginatedBy ?? 30,
        hasNext: over.hasNext ?? false,
        backlogTotal: over.backlogTotal ?? list.length,
    };
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/* --------------------------------------------------------------------------- *
 * Mock wiring
 * --------------------------------------------------------------------------- */

const getProjectBySlug = jest.fn();
const getProjectStats = jest.fn();
const getUserStoriesFilters = jest.fn();
const getUserFilters = jest.fn();
const storeUserFilters = jest.fn();
const listUserStories = jest.fn();
// M2: authoritative PAGINATED backlog list (reads x-pagination-next + the
// Taiga-Info-Backlog-Total-Userstories total header).
const listUnassignedUserStories = jest.fn();
// C6: authoritative by-id detail + attachments fetched BEFORE opening edit.
const getUserStory = jest.fn();
const listUserStoryAttachments = jest.fn();
const listMilestones = jest.fn();
const bulkUpdateBacklogOrder = jest.fn();
const bulkUpdateMilestone = jest.fn();
const save = jest.fn();
const remove = jest.fn();
// C7: shared React story-lightbox submit path (create single + bulk-create).
const create = jest.fn();
const bulkCreateUserStories = jest.fn();

const fakeClient = {
    getProjectBySlug,
    getProjectStats,
    getUserStoriesFilters,
    getUserFilters,
    storeUserFilters,
    listUserStories,
    listUnassignedUserStories,
    getUserStory,
    listUserStoryAttachments,
    listMilestones,
    bulkUpdateBacklogOrder,
    bulkUpdateMilestone,
    save,
    remove,
    create,
    bulkCreateUserStories,
} as unknown as ApiClient;

const setupConnection = jest.fn();
const stop = jest.fn();
const subscribe = jest.fn();
const unsubscribe = jest.fn();
const isConnected = jest.fn<boolean, []>(() => true);

const fakeEvents = {
    setupConnection,
    stop,
    subscribe,
    unsubscribe,
    isConnected,
} as unknown as EventsClient;

let capturedHandlers: ProjectEventHandlers = {};
let capturedCleanup: jest.Mock;

const mockedCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;
const mockedCreateEventsClient = createEventsClient as jest.MockedFunction<
    typeof createEventsClient
>;
const mockedSubscribeToProject = subscribeToProject as jest.MockedFunction<
    typeof subscribeToProject
>;

/* --------------------------------------------------------------------------- *
 * Lifecycle
 * --------------------------------------------------------------------------- */

beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    try {
        window.localStorage.clear();
    } catch {
        /* ignore */
    }

    // Authoritative project + stats (C1 / C5).
    getProjectBySlug.mockResolvedValue(project());
    getProjectStats.mockResolvedValue(statsFixture());
    getUserStoriesFilters.mockResolvedValue({ statuses: [{ id: 1, name: "New" }] });
    getUserFilters.mockResolvedValue({});
    storeUserFilters.mockResolvedValue(undefined);
    listUserStories.mockResolvedValue([us(10), us(11)]);
    // M2: the paginated endpoint the hook actually calls (authoritative total 2).
    listUnassignedUserStories.mockResolvedValue(page([us(10), us(11)], { backlogTotal: 2 }));
    // C6: default detail mirrors the list row (no extra description) so the
    // dirty-diff parity tests are unaffected; the C6 test overrides this.
    getUserStory.mockImplementation((_pid: number, usId: number) =>
        Promise.resolve(us(usId)),
    );
    listUserStoryAttachments.mockResolvedValue([]);
    listMilestones.mockImplementation((_pid: number, filters?: { closed?: boolean }) =>
        Promise.resolve(
            filters?.closed
                ? {
                      milestones: [sprint(6, { closed: true, total_points: 5, closed_points: 5 })],
                      closed: 1,
                      open: 0,
                  }
                : {
                      milestones: [
                          sprint(5, {
                              total_points: 8,
                              closed_points: 3,
                              user_stories: [us(20), us(21)],
                          }),
                      ],
                      closed: 1,
                      open: 1,
                  },
        ),
    );
    bulkUpdateBacklogOrder.mockResolvedValue([{ ...us(11), milestone: null, backlog_order: 0 }]);
    bulkUpdateMilestone.mockResolvedValue([]);
    save.mockImplementation((_name: string, entity: unknown) => Promise.resolve(entity));
    remove.mockResolvedValue(undefined);
    // C7: create echoes the persisted story; bulk-create returns the new list.
    create.mockImplementation((_name: string, body: Record<string, unknown>) =>
        Promise.resolve({ id: 999, ...body }),
    );
    bulkCreateUserStories.mockResolvedValue([us(30), us(31)]);
    isConnected.mockReturnValue(true);

    mockedCreateApiClient.mockReturnValue(fakeClient);
    mockedCreateEventsClient.mockReturnValue(fakeEvents);
    capturedHandlers = {};
    capturedCleanup = jest.fn();
    mockedSubscribeToProject.mockImplementation(
        (_client, _projectId, handlers: ProjectEventHandlers) => {
            capturedHandlers = handlers;
            return capturedCleanup;
        },
    );
});

afterEach(() => {
    jest.useRealTimers();
});

/* --------------------------------------------------------------------------- *
 * Helpers
 * --------------------------------------------------------------------------- */

async function renderLoaded(): Promise<{
    result: { current: BacklogVM };
    unmount: () => void;
}> {
    const view = renderHook(() => useBacklogStories(context));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    return view;
}

/* --------------------------------------------------------------------------- *
 * Mount + authoritative load (C1) + real stats (C5)
 * --------------------------------------------------------------------------- */

describe("mount + authoritative load", () => {
    it("loads the project by slug (not a window global) and exposes the full VM", async () => {
        const { result } = await renderLoaded();

        // C1: authoritative project-by-slug load; no resolveProject, no window bridge.
        expect(getProjectBySlug).toHaveBeenCalledWith("p1");
        expect(result.current.projectId).toBe(7);
        expect(result.current.project?.id).toBe(7);
        // userstories sorted by backlog_order.
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11]);
        expect(result.current.totalUserStories).toBe(2);
        expect(result.current.sprints.map((s) => s.id)).toEqual([5]);
        expect(result.current.totalMilestones).toBe(2);
        expect(result.current.totalClosedMilestones).toBe(1);
        // statuses came from the authoritative project.us_statuses.
        expect(result.current.statuses.map((s) => s.id)).toEqual([1, 2]);
        // findCurrentSprint matches the wide-range sprint.
        expect(result.current.currentSprint?.id).toBe(5);
        // WS wired.
        expect(result.current.eventsConnected).toBe(true);
        expect(setupConnection).toHaveBeenCalledTimes(1);
        // No error surfaced on the happy path.
        expect(result.current.errorMessage).toBeNull();
    });

    it("computes stats from the REAL /stats payload (assigned_points + speed), not derived approximations (C5)", async () => {
        const { result } = await renderLoaded();

        expect(getProjectStats).toHaveBeenCalledWith(7);
        expect(result.current.stats).not.toBeNull();
        // REAL assigned_points (60) — NOT closed_points (40).
        expect(result.current.stats?.assigned_points).toBe(60);
        expect(result.current.stats?.closed_points).toBe(40);
        expect(result.current.stats?.assigned_points).not.toBe(
            result.current.stats?.closed_points,
        );
        // REAL velocity — NOT the previous hard-coded 0.
        expect(result.current.stats?.speed).toBe(12.5);
        // completedPercentage uses total_points||defined_points as denominator.
        expect(result.current.stats?.completedPercentage).toBe(40);
        // graph placeholder gated off when total_points + total_milestones exist.
        expect(result.current.showGraphPlaceholder).toBe(false);
    });

    it("uses the filters endpoint for statuses when the project carries none", async () => {
        getProjectBySlug.mockResolvedValueOnce(project({ us_statuses: [] }));
        const { result } = await renderLoaded();
        expect(getUserStoriesFilters).toHaveBeenCalledWith({ project: 7 });
        expect(result.current.statuses.map((s) => s.id)).toEqual([1]);
    });

    it("fails CLOSED when the project load rejects: project stays null + error surfaced (C1)", async () => {
        getProjectBySlug.mockRejectedValueOnce(new Error("network down"));
        const { result } = renderHook(() => useBacklogStories(context));
        await waitFor(() => expect(result.current.loading).toBe(false));
        // No permissive fabricated board — project is null.
        expect(result.current.project).toBeNull();
        // A sanitized, user-visible message is published (REAL sanitizeErrorMessage).
        expect(result.current.errorMessage).toBe(GENERIC_ERROR);
    });

    it("never leaves the screen hanging when a downstream loader rejects", async () => {
        listUnassignedUserStories.mockRejectedValueOnce(new Error("boom"));
        const { result } = renderHook(() => useBacklogStories(context));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.errorMessage).toBe(GENERIC_ERROR);
    });
});

/* --------------------------------------------------------------------------- *
 * Permissions / activation (from the authoritative project)
 * --------------------------------------------------------------------------- */

describe("permissions + activation", () => {
    it("reads my_permissions for hasPermission", async () => {
        const { result } = await renderLoaded();
        expect(result.current.hasPermission("modify_us")).toBe(true);
        expect(result.current.hasPermission("delete_project")).toBe(false);
    });

    it("gates everything off when my_permissions is empty (no fabricated permissive stub)", async () => {
        getProjectBySlug.mockResolvedValueOnce(project({ my_permissions: [] }));
        const { result } = await renderLoaded();
        expect(result.current.hasPermission("modify_us")).toBe(false);
    });

    it("reflects is_backlog_activated === false", async () => {
        getProjectBySlug.mockResolvedValueOnce(project({ is_backlog_activated: false }));
        const { result } = await renderLoaded();
        expect(result.current.isBacklogActivated).toBe(false);
    });

    // C5: a deactivated module must FAIL CLOSED — the screen loads the project
    // (it must read the flag to gate on it) but fetches NO backlog data and opens
    // NO WebSocket, mirroring the legacy `permissionDenied()` short-circuit in
    // `BacklogController.loadProject`.
    it("C5: fails closed when is_backlog_activated === false — no data fetch, no WebSocket", async () => {
        getProjectBySlug.mockResolvedValueOnce(project({ is_backlog_activated: false }));
        const { result } = await renderLoaded();

        // The project WAS loaded (the flag must be read to gate on it)...
        expect(getProjectBySlug).toHaveBeenCalledTimes(1);
        // ...but NO backlog data was fetched.
        expect(listUnassignedUserStories).not.toHaveBeenCalled();
        expect(getProjectStats).not.toHaveBeenCalled();
        expect(listMilestones).not.toHaveBeenCalled();
        // ...and the WebSocket never subscribed.
        expect(setupConnection).not.toHaveBeenCalled();
        expect(mockedSubscribeToProject).not.toHaveBeenCalled();
        // The screen still settles (it renders the placeholder, never hangs).
        expect(result.current.loading).toBe(false);
        expect(result.current.isBacklogActivated).toBe(false);
    });

    // Positive control: with the module ACTIVATED, the data path and WebSocket
    // subscription both run — proving the C5 gate does not break the happy path.
    it("C5: subscribes + loads data when is_backlog_activated === true", async () => {
        const { result } = await renderLoaded();
        expect(listUnassignedUserStories).toHaveBeenCalled();
        expect(setupConnection).toHaveBeenCalledTimes(1);
        expect(mockedSubscribeToProject).toHaveBeenCalledTimes(1);
        expect(result.current.isBacklogActivated).toBe(true);
    });
});

/* --------------------------------------------------------------------------- *
 * Drag / move (the critical path)
 * --------------------------------------------------------------------------- */

describe("moveUs", () => {
    it("issues exactly one bulk-order call and reconciles from the server", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.moveUs([us(11)], 0, null, null, us(10));
        });
        await waitFor(() => expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1));
        // (projectId, currentSprintId, previousUsId, nextUsId, bulkUserStoryIds)
        expect(bulkUpdateBacklogOrder).toHaveBeenCalledWith(7, null, null, 10, [11]);
    });

    it("coalesces a second drag while the first is in flight, then drains it on resolve", async () => {
        const { result } = await renderLoaded();
        const first = deferred<UserStory[]>();
        bulkUpdateBacklogOrder.mockReturnValueOnce(first.promise).mockResolvedValue([]);

        act(() => {
            result.current.moveUs([us(11)], 0, null, null, us(10)); // queue length 1 -> drains
            result.current.moveUs([us(10)], 1, null, us(11), null); // queue length 2 -> coalesced
        });
        // Only the first drag fired the API.
        expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1);

        await act(async () => {
            first.resolve([]);
            await Promise.resolve();
        });
        // The coalesced drag drains one-at-a-time on resolve.
        await waitFor(() => expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(2));
    });

    it("rolls the optimistic reshuffle back and surfaces an error when the bulk call rejects", async () => {
        const { result } = await renderLoaded();
        const before = result.current.userstories.map((u) => u.id);
        bulkUpdateBacklogOrder.mockRejectedValueOnce(new Error("409 conflict"));

        act(() => {
            result.current.moveUs([us(11)], 0, null, null, us(10));
        });
        await waitFor(() => expect(bulkUpdateBacklogOrder).toHaveBeenCalled());
        await waitFor(() =>
            expect(result.current.userstories.map((u) => u.id)).toEqual(before),
        );
        // M2: sanitized message published (proves the REAL sanitize ran).
        expect(result.current.errorMessage).toBe(GENERIC_ERROR);
    });

    it("per-op rollback: a concurrent status change SURVIVES a rejected move (M1 CWE-362 fix)", async () => {
        const { result } = await renderLoaded();
        // Backlog is [10,11]. Start a move of 11 to the front with a DEFERRED bulk
        // call so the move stays in flight.
        const d = deferred<UserStory[]>();
        bulkUpdateBacklogOrder.mockReturnValueOnce(d.promise);
        act(() => {
            result.current.moveUs([us(11)], 0, null, null, us(10));
        });
        await waitFor(() => expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1));

        // While the move is in flight, a DIFFERENT story (10) gets a status change
        // that persists to the server.
        save.mockResolvedValueOnce({ ...us(10), status: 2 });
        await act(async () => {
            result.current.updateUserStoryStatus(us(10), 2);
            await Promise.resolve();
        });
        await waitFor(() =>
            expect(result.current.userstories.find((u) => u.id === 10)?.status).toBe(2),
        );

        // Now the move REJECTS. A whole-state snapshot rollback (the old bug) would
        // clobber story 10 back to status 1; the per-op rollback restores ONLY
        // story 11's position and leaves story 10's newer change intact.
        await act(async () => {
            d.reject(new Error("409 conflict"));
            await Promise.resolve();
        });
        await waitFor(() => expect(result.current.errorMessage).toBe(GENERIC_ERROR));
        expect(result.current.userstories.find((u) => u.id === 10)?.status).toBe(2);
        // Order restored to the pre-move arrangement.
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11]);
    });

    it("reloads from the server after the batch when the WebSocket is disconnected", async () => {
        const { result } = await renderLoaded();
        isConnected.mockReturnValue(false);
        listMilestones.mockClear();
        getProjectStats.mockClear();

        act(() => {
            result.current.moveUs([us(11)], 0, null, null, us(10));
        });
        await waitFor(() => expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1));
        // Fallback reload = loadSprints + loadClosedSprints + authoritative stats.
        await waitFor(() => expect(listMilestones).toHaveBeenCalled());
        await waitFor(() => expect(getProjectStats).toHaveBeenCalled());
    });
});

describe("moveToSprint / moveUsToTop", () => {
    it("moveToSprint issues one milestone bulk call and reloads authoritative stats", async () => {
        const { result } = await renderLoaded();
        listMilestones.mockClear();
        getProjectStats.mockClear();
        act(() => {
            result.current.moveToSprint([us(10)], 5);
        });
        await waitFor(() => expect(bulkUpdateMilestone).toHaveBeenCalledTimes(1));
        expect(bulkUpdateMilestone).toHaveBeenCalledWith(7, 5, [{ us_id: 10, order: 10 }]);
        await waitFor(() => expect(listMilestones).toHaveBeenCalled());
        await waitFor(() => expect(getProjectStats).toHaveBeenCalled());
    });

    it("moveToSprint rolls back and surfaces an error on reject", async () => {
        const { result } = await renderLoaded();
        const before = result.current.userstories.map((u) => u.id);
        bulkUpdateMilestone.mockRejectedValueOnce(new Error("boom"));
        act(() => {
            result.current.moveToSprint([us(10)], 5);
        });
        await waitFor(() => expect(bulkUpdateMilestone).toHaveBeenCalled());
        await waitFor(() =>
            expect(result.current.userstories.map((u) => u.id)).toEqual(before),
        );
        expect(result.current.errorMessage).toBe(GENERIC_ERROR);
    });

    it("moveUsToTop reuses moveUs with the current first story as nextUs", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.moveUsToTop(us(11));
        });
        await waitFor(() => expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1));
        expect(bulkUpdateBacklogOrder).toHaveBeenCalledWith(7, null, null, 10, [11]);
    });

    it("moveUsToTop is a no-op when the story is already first", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.moveUsToTop(us(10)); // already first
        });
        expect(bulkUpdateBacklogOrder).not.toHaveBeenCalled();
    });
});

describe("read-only project reorder guard (M4)", () => {
    it("no-ops moveUs / moveToSprint on a read-only (archived_code) project — no bulk calls", async () => {
        // The row/sprint drag sensors are gated on `canEditStory`; this pins the
        // hook-level defense-in-depth guard that also refuses to persist a
        // reorder or cross-sprint move if invoked programmatically on a
        // read-only project. Mirrors the legacy `sortable.coffee` init guard.
        getProjectBySlug.mockResolvedValue(project({ archived_code: "ARCH" }));
        const { result } = await renderLoaded();

        act(() => {
            result.current.moveUs([us(11)], 0, null, null, us(10));
        });
        act(() => {
            result.current.moveToSprint([us(10)], 5);
        });
        act(() => {
            result.current.moveUsToTop(us(11));
        });

        // Neither frozen bulk endpoint may be reached.
        expect(bulkUpdateBacklogOrder).not.toHaveBeenCalled();
        expect(bulkUpdateMilestone).not.toHaveBeenCalled();
    });

    it("persists moveUs on a writable project (positive control)", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.moveUs([us(11)], 0, null, null, us(10));
        });
        await waitFor(() => expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1));
    });
});

/* --------------------------------------------------------------------------- *
 * Inline editors + delete
 * --------------------------------------------------------------------------- */

describe("inline editors + delete", () => {
    it("updateUserStoryStatus PATCHes only the dirty status field + reloads stats", async () => {
        const { result } = await renderLoaded();
        getProjectStats.mockClear();
        act(() => {
            result.current.updateUserStoryStatus(us(10), 2);
        });
        await waitFor(() => expect(save).toHaveBeenCalled());
        expect(save).toHaveBeenCalledWith(
            "userstories",
            expect.objectContaining({ id: 10, status: 2 }),
            { status: 2 },
        );
        await waitFor(() =>
            expect(result.current.userstories.find((u) => u.id === 10)?.status).toBe(2),
        );
        await waitFor(() => expect(getProjectStats).toHaveBeenCalled());
    });

    it("updateUserStoryStatus reloads + surfaces an error on reject", async () => {
        const { result } = await renderLoaded();
        save.mockRejectedValueOnce(new Error("save failed"));
        listUnassignedUserStories.mockClear();
        act(() => {
            result.current.updateUserStoryStatus(us(10), 2);
        });
        await waitFor(() => expect(listUnassignedUserStories).toHaveBeenCalled());
        await waitFor(() => expect(result.current.errorMessage).toBe(GENERIC_ERROR));
    });

    it("updateUserStoryPoints applies to the given role", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.updateUserStoryPoints(us(10), 3, 99);
        });
        await waitFor(() => expect(save).toHaveBeenCalled());
        expect(save).toHaveBeenCalledWith(
            "userstories",
            expect.objectContaining({ id: 10 }),
            { points: { "3": 99 } },
        );
    });

    it("updateUserStoryPoints applies to the first computable role when roleId is null", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.updateUserStoryPoints(us(10), null, 42);
        });
        await waitFor(() => expect(save).toHaveBeenCalled());
        // project role id 3 is computable.
        expect(save).toHaveBeenCalledWith(
            "userstories",
            expect.objectContaining({ id: 10 }),
            { points: { "3": 42 } },
        );
    });

    // C7: delete is now gated by the shared localized `ConfirmDeleteLightbox`,
    // NOT the previous hard-coded English `window.confirm`. `deleteUserStory`
    // only OPENS the modal; the DELETE runs on `confirmDelete`, and
    // `cancelDelete` is a pure no-op.
    it("deleteUserStory opens the localized confirmation modal and does NOT delete yet (C7 request path)", async () => {
        const confirmSpy = jest.spyOn(window, "confirm");
        const { result } = await renderLoaded();
        act(() => {
            result.current.deleteUserStory(us(10));
        });

        // The modal is open, labelled with the story subject; NO native
        // window.confirm is used and NO request is issued yet.
        expect(result.current.pendingDelete).not.toBeNull();
        expect(result.current.pendingDelete?.subject).toBe("US 10");
        expect(result.current.pendingDelete?.target.id).toBe(10);
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11]);
        confirmSpy.mockRestore();
    });

    it("confirmDelete removes optimistically, toggles savingUs, reloads, then closes the modal (C7 confirm path)", async () => {
        const { result } = await renderLoaded();
        listMilestones.mockClear();
        getProjectStats.mockClear();
        act(() => {
            result.current.deleteUserStory(us(10));
        });
        await act(async () => {
            result.current.confirmDelete();
        });
        await waitFor(() => expect(remove).toHaveBeenCalledWith("userstories", 10));
        await waitFor(() =>
            expect(result.current.userstories.map((u) => u.id)).toEqual([11]),
        );
        await waitFor(() => expect(listMilestones).toHaveBeenCalled());
        await waitFor(() => expect(getProjectStats).toHaveBeenCalled());
        // pending guard settled + modal closed (legacy askResponse.finish()).
        await waitFor(() => expect(result.current.savingUs).toBe(false));
        expect(result.current.pendingDelete).toBeNull();
    });

    it("cancelDelete closes the modal without deleting (C7 cancel path)", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.deleteUserStory(us(10));
        });
        expect(result.current.pendingDelete).not.toBeNull();

        act(() => {
            result.current.cancelDelete();
        });

        expect(result.current.pendingDelete).toBeNull();
        expect(remove).not.toHaveBeenCalled();
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11]);
    });

    it("confirmDelete re-inserts the removed story + surfaces an error on reject, then closes (C7 error/rollback path)", async () => {
        remove.mockRejectedValueOnce(new Error("delete failed"));
        const { result } = await renderLoaded();
        act(() => {
            result.current.deleteUserStory(us(10));
        });
        await act(async () => {
            result.current.confirmDelete();
        });
        await waitFor(() => expect(remove).toHaveBeenCalled());
        // The optimistically-removed story is restored to its original slot.
        await waitFor(() =>
            expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11]),
        );
        expect(result.current.errorMessage).toBe(GENERIC_ERROR);
        await waitFor(() => expect(result.current.savingUs).toBe(false));
        expect(result.current.pendingDelete).toBeNull();
    });
});

/* --------------------------------------------------------------------------- *
 * Story lightboxes (C7 - shared React story-form strategy)
 *
 * The Backlog screen mounts the SAME shared React `StoryFormLightbox` /
 * `BulkStoryLightbox` the Kanban screen uses and shapes requests through the
 * SAME `buildCreateStoryPayload` / `diffStoryValues` builders. The opener
 * actions set `activeLightbox`; the awaited, double-submit-guarded submit
 * handlers call the frozen `/userstories` endpoints and reload on success,
 * keeping the lightbox open with a sanitized message on failure (M2). The hook
 * no longer dispatches `tg-react:us:*` CustomEvents into the void (the old
 * defect this suite previously blessed - findings C7 / M10).
 * --------------------------------------------------------------------------- */

describe("story lightboxes (C7)", () => {
    it("addNewUs('standard') opens the create lightbox", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.addNewUs("standard");
        });
        expect(result.current.activeLightbox).toEqual({ type: "create" });
    });

    it("addNewUs('bulk') opens the bulk lightbox", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.addNewUs("bulk");
        });
        expect(result.current.activeLightbox).toEqual({ type: "bulk" });
    });

    it("editUserStory opens the edit lightbox targeting the story id (C6: after detail fetch)", async () => {
        const { result } = await renderLoaded();
        await act(async () => {
            result.current.editUserStory(us(11));
        });
        // C6: the detail + attachments are fetched BEFORE the lightbox opens.
        expect(getUserStory).toHaveBeenCalledWith(7, 11);
        expect(listUserStoryAttachments).toHaveBeenCalledWith(7, 11);
        await waitFor(() =>
            expect(result.current.activeLightbox).toEqual({ type: "edit", usId: 11 }),
        );
        expect(result.current.editLoading).toBe(false);
    });

    it("closeLightbox clears the active lightbox", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.addNewUs("standard");
        });
        act(() => {
            result.current.closeLightbox();
        });
        expect(result.current.activeLightbox).toBeNull();
    });

    it("submitNewUs POSTs the built create payload, closes, and reloads (C7/M2)", async () => {
        const { result } = await renderLoaded();
        getProjectStats.mockClear();
        listUnassignedUserStories.mockClear();
        act(() => {
            result.current.addNewUs("standard");
        });
        act(() => {
            result.current.submitNewUs(createEmptyStoryValues({ subject: "Fresh story" }));
        });
        await waitFor(() => expect(create).toHaveBeenCalled());
        // project id 7; status falls back to the first us status (1).
        expect(create).toHaveBeenCalledWith(
            "userstories",
            expect.objectContaining({ project: 7, status: 1, subject: "Fresh story" }),
        );
        // `us_position` is a client-side ordering hint, never a POST field.
        const body = create.mock.calls[0][1] as Record<string, unknown>;
        expect(body).not.toHaveProperty("us_position");
        await waitFor(() => expect(result.current.activeLightbox).toBeNull());
        await waitFor(() => expect(listUnassignedUserStories).toHaveBeenCalled());
        await waitFor(() => expect(getProjectStats).toHaveBeenCalled());
        await waitFor(() => expect(result.current.savingUs).toBe(false));
    });

    it("submitNewUs is a no-op unless a create lightbox is open", async () => {
        const { result } = await renderLoaded();
        await act(async () => {
            result.current.editUserStory(us(11)); // wrong lightbox type
        });
        await waitFor(() =>
            expect(result.current.activeLightbox).toEqual({ type: "edit", usId: 11 }),
        );
        act(() => {
            result.current.submitNewUs(createEmptyStoryValues({ subject: "X" }));
        });
        expect(create).not.toHaveBeenCalled();
    });

    it("submitEditUs PATCHes only the dirty diff, closes, and reloads", async () => {
        const { result } = await renderLoaded();
        const story = us(11);
        await act(async () => {
            result.current.editUserStory(story);
        });
        await waitFor(() =>
            expect(result.current.activeLightbox).toEqual({ type: "edit", usId: 11 }),
        );
        const values = createEmptyStoryValues({
            ...storyToFormValues(story),
            subject: "US 11 edited",
        });
        act(() => {
            result.current.submitEditUs(values);
        });
        await waitFor(() => expect(save).toHaveBeenCalled());
        expect(save).toHaveBeenCalledWith(
            "userstories",
            expect.objectContaining({ id: 11 }),
            { subject: "US 11 edited" },
        );
        await waitFor(() => expect(result.current.activeLightbox).toBeNull());
    });

    it("submitEditUs closes WITHOUT a request when nothing changed", async () => {
        const { result } = await renderLoaded();
        const story = us(11);
        await act(async () => {
            result.current.editUserStory(story);
        });
        await waitFor(() =>
            expect(result.current.activeLightbox).toEqual({ type: "edit", usId: 11 }),
        );
        act(() => {
            result.current.submitEditUs(createEmptyStoryValues(storyToFormValues(story)));
        });
        expect(save).not.toHaveBeenCalled();
        expect(result.current.activeLightbox).toBeNull();
    });

    it("submitBulkUs bulk-creates one story per line, closes, and reloads", async () => {
        const { result } = await renderLoaded();
        listUnassignedUserStories.mockClear();
        act(() => {
            result.current.addNewUs("bulk");
        });
        act(() => {
            result.current.submitBulkUs({
                bulk: "Story A\nStory B",
                status: null,
                swimlane: null,
                us_position: "bottom",
            });
        });
        await waitFor(() => expect(bulkCreateUserStories).toHaveBeenCalled());
        // project 7; status falls back to the first us status (1); backlog carries
        // no swimlane (isKanban=false), so the swimlane arg is null.
        expect(bulkCreateUserStories).toHaveBeenCalledWith(7, 1, "Story A\nStory B", null);
        await waitFor(() => expect(result.current.activeLightbox).toBeNull());
        await waitFor(() => expect(listUnassignedUserStories).toHaveBeenCalled());
    });

    it("keeps the lightbox OPEN with a sanitized error when create rejects (M2)", async () => {
        const { result } = await renderLoaded();
        create.mockRejectedValueOnce(new Error("boom"));
        act(() => {
            result.current.addNewUs("standard");
        });
        act(() => {
            result.current.submitNewUs(createEmptyStoryValues({ subject: "Fresh" }));
        });
        await waitFor(() => expect(result.current.errorMessage).toBe(GENERIC_ERROR));
        expect(result.current.activeLightbox).toEqual({ type: "create" });
        await waitFor(() => expect(result.current.savingUs).toBe(false));
    });

    it("guards against a double create submit while one is in flight (M2)", async () => {
        const { result } = await renderLoaded();
        const d = deferred<UserStory>();
        create.mockReturnValueOnce(d.promise);
        act(() => {
            result.current.addNewUs("standard");
        });
        act(() => {
            result.current.submitNewUs(createEmptyStoryValues({ subject: "One" }));
        });
        await waitFor(() => expect(result.current.savingUs).toBe(true));
        // A second submit while the first is pending is ignored.
        act(() => {
            result.current.submitNewUs(createEmptyStoryValues({ subject: "Two" }));
        });
        expect(create).toHaveBeenCalledTimes(1);
        await act(async () => {
            d.resolve(us(999));
            await Promise.resolve();
        });
        await waitFor(() => expect(result.current.savingUs).toBe(false));
    });
});


/* --------------------------------------------------------------------------- *
 * Selection + bulk-move toolbar
 * --------------------------------------------------------------------------- */

describe("selection + bulk move", () => {
    it("toggleSelectedUs adds and removes ids", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleSelectedUs(us(10), true);
        });
        expect(result.current.selectedUs.has(10)).toBe(true);
        act(() => {
            result.current.toggleSelectedUs(us(10), false);
        });
        expect(result.current.selectedUs.has(10)).toBe(false);
    });

    it("moveSelectedToCurrentSprint moves the selection to the current sprint and clears it", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleSelectedUs(us(10), true);
        });
        act(() => {
            result.current.moveSelectedToCurrentSprint();
        });
        await waitFor(() => expect(bulkUpdateMilestone).toHaveBeenCalledTimes(1));
        // current sprint id is 5.
        expect(bulkUpdateMilestone).toHaveBeenCalledWith(7, 5, [{ us_id: 10, order: 10 }]);
        expect(result.current.selectedUs.size).toBe(0);
    });

    it("moveSelectedToLatestSprint targets sprints[0]", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleSelectedUs(us(11), true);
        });
        act(() => {
            result.current.moveSelectedToLatestSprint();
        });
        await waitFor(() => expect(bulkUpdateMilestone).toHaveBeenCalledTimes(1));
        expect(bulkUpdateMilestone).toHaveBeenCalledWith(7, 5, [{ us_id: 11, order: 11 }]);
    });

    it("moveSelectedToCurrentSprint is a no-op when nothing is selected", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.moveSelectedToCurrentSprint();
        });
        expect(bulkUpdateMilestone).not.toHaveBeenCalled();
    });
});

/* --------------------------------------------------------------------------- *
 * Sprint lightbox
 * --------------------------------------------------------------------------- */

describe("sprint lightbox", () => {
    it("openCreateSprint opens the create lightbox with the last open sprint", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.openCreateSprint();
        });
        expect(result.current.sprintLightbox.open).toBe(true);
        expect(result.current.sprintLightbox.mode).toBe("create");
        expect(result.current.sprintLightbox.sprint).toBeNull();
        expect(result.current.sprintLightbox.lastSprint?.id).toBe(5);
    });

    it("createSprintFromForecasting moves the forecasted stories into the existing sprint with NO modal (M3, direct)", async () => {
        const { result } = await renderLoaded();
        // Turn forecasting ON. The default fixture has an OPEN sprint (id 5,
        // 8 pts) whose points are below the velocity (12.5), so the forecast row
        // reads "Move to Current Sprint" (forecastNewSprint === false).
        act(() => {
            result.current.toggleVelocityForecasting();
        });
        expect(result.current.displayVelocity).toBe(true);
        expect(result.current.forecastNewSprint).toBe(false);
        bulkUpdateMilestone.mockClear();
        act(() => {
            result.current.createSprintFromForecasting();
        });
        // No modal — a direct move.
        expect(result.current.sprintLightbox.open).toBe(false);
        // Exactly ONE bulk-update-us-milestone targeting sprints[0] (id 5) with
        // the forecasted backlog stories (10, 11) at their sprint_order.
        await waitFor(() => expect(bulkUpdateMilestone).toHaveBeenCalledTimes(1));
        expect(bulkUpdateMilestone).toHaveBeenCalledWith(7, 5, [
            { us_id: 10, order: 10 },
            { us_id: 11, order: 11 },
        ]);
        // Forecasting turned off after the move (legacy toggleVelocityForecasting).
        await waitFor(() => expect(result.current.displayVelocity).toBe(false));
    });

    it("openEditSprint opens the edit lightbox for a sprint", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.openEditSprint(sprint(5));
        });
        expect(result.current.sprintLightbox.mode).toBe("edit");
        expect(result.current.sprintLightbox.sprint?.id).toBe(5);
    });

    it("closeSprintLightbox closes without changing mode/sprint", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.openEditSprint(sprint(5));
        });
        act(() => {
            result.current.closeSprintLightbox();
        });
        expect(result.current.sprintLightbox.open).toBe(false);
        expect(result.current.sprintLightbox.sprint?.id).toBe(5);
    });

    it("onSprintSaved closes the lightbox and reloads sprints + stats", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.openCreateSprint();
        });
        listMilestones.mockClear();
        getProjectStats.mockClear();
        bulkUpdateMilestone.mockClear();
        act(() => {
            result.current.onSprintSaved();
        });
        expect(result.current.sprintLightbox.open).toBe(false);
        await waitFor(() => expect(listMilestones).toHaveBeenCalled());
        await waitFor(() => expect(getProjectStats).toHaveBeenCalled());
        // M3: a NON-forecast save (opened via openCreateSprint) carries no
        // pending forecast, so it must NOT move any stories.
        expect(bulkUpdateMilestone).not.toHaveBeenCalled();
    });

    it("onSprintDeleted reloads everything and turns velocity off", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleVelocityForecasting(); // velocity on
        });
        expect(result.current.displayVelocity).toBe(true);
        listUnassignedUserStories.mockClear();
        act(() => {
            result.current.onSprintDeleted();
        });
        expect(result.current.sprintLightbox.open).toBe(false);
        await waitFor(() => expect(listUnassignedUserStories).toHaveBeenCalled());
        await waitFor(() => expect(result.current.displayVelocity).toBe(false));
    });
});

/* --------------------------------------------------------------------------- *
 * Forecast story movement (M3) — the modal (create-new-sprint) path
 * --------------------------------------------------------------------------- */

describe("forecast story movement (M3)", () => {
    // Return the given OPEN sprints from `listMilestones` (closed list stays
    // empty). A first sprint that OVERFLOWS the velocity (points > speed 12.5)
    // makes `forecastNewSprint` true so the forecast row reads "create sprint and
    // add US" — the modal path.
    function useOpenSprints(openSprints: Milestone[]): void {
        listMilestones.mockImplementation((_pid: number, params?: { closed?: boolean }) =>
            Promise.resolve(
                params?.closed
                    ? { milestones: [], closed: 0, open: 0 }
                    : { milestones: openSprints, closed: 0, open: openSprints.length },
            ),
        );
    }

    it("opens the create modal carrying the forecast and moves NOTHING yet (M3)", async () => {
        useOpenSprints([sprint(5, { total_points: 20 })]); // 20 > 12.5 => forecastNewSprint
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleVelocityForecasting();
        });
        expect(result.current.forecastNewSprint).toBe(true);
        bulkUpdateMilestone.mockClear();
        act(() => {
            result.current.createSprintFromForecasting();
        });
        // The create modal opens; no milestone move happens at this point.
        expect(result.current.sprintLightbox.open).toBe(true);
        expect(result.current.sprintLightbox.mode).toBe("create");
        expect(bulkUpdateMilestone).not.toHaveBeenCalled();
    });

    it("moves the carried forecast stories into the just-created sprint on modal success (M3)", async () => {
        useOpenSprints([sprint(5, { total_points: 20 })]);
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleVelocityForecasting();
        });
        expect(result.current.forecastNewSprint).toBe(true);
        act(() => {
            result.current.createSprintFromForecasting();
        });
        expect(result.current.sprintLightbox.open).toBe(true);
        // Simulate the sprint being created: the reload now returns the NEW
        // sprint (id 9) as the FIRST open sprint.
        useOpenSprints([sprint(9, { total_points: 0 }), sprint(5, { total_points: 20 })]);
        bulkUpdateMilestone.mockClear();
        act(() => {
            result.current.onSprintSaved();
        });
        // The carried forecast stories (10, 11) are moved into the new sprint
        // (id 9) with exactly ONE bulk-update-us-milestone (target sprints[0].id).
        await waitFor(() => expect(bulkUpdateMilestone).toHaveBeenCalledTimes(1));
        expect(bulkUpdateMilestone).toHaveBeenCalledWith(7, 9, [
            { us_id: 10, order: 10 },
            { us_id: 11, order: 11 },
        ]);
    });

    it("consumes the pending forecast once — a later plain save moves nothing (M3)", async () => {
        useOpenSprints([sprint(5, { total_points: 20 })]);
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleVelocityForecasting();
        });
        act(() => {
            result.current.createSprintFromForecasting();
        });
        useOpenSprints([sprint(9), sprint(5, { total_points: 20 })]);
        act(() => {
            result.current.onSprintSaved();
        });
        await waitFor(() => expect(bulkUpdateMilestone).toHaveBeenCalledTimes(1));
        bulkUpdateMilestone.mockClear();
        // Second save: the pending forecast was already consumed => no move.
        act(() => {
            result.current.onSprintSaved();
        });
        await waitFor(() => expect(listMilestones).toHaveBeenCalled());
        expect(bulkUpdateMilestone).not.toHaveBeenCalled();
    });
});

/* --------------------------------------------------------------------------- *
 * Toggles + search + M5 preference persistence
 * --------------------------------------------------------------------------- */

describe("toggles + search + preferences (M5)", () => {
    it("showTags defaults to true when nothing is stored", async () => {
        const { result } = await renderLoaded();
        expect(result.current.showTags).toBe(true);
    });

    it("showTags reads the LEGACY generateHash key and flips to false only when stored strictly false", async () => {
        window.localStorage.setItem(SHOW_TAGS_KEY_7, JSON.stringify(false));
        const { result } = await renderLoaded();
        expect(result.current.showTags).toBe(false);
    });

    it("a stored `true` (or absent) keeps showTags true (legacy default-true semantics)", async () => {
        window.localStorage.setItem(SHOW_TAGS_KEY_7, JSON.stringify(true));
        const { result } = await renderLoaded();
        expect(result.current.showTags).toBe(true);
    });

    it("toggleShowTags flips + persists under the LEGACY hashed key as a JSON boolean", async () => {
        const { result } = await renderLoaded();
        expect(result.current.showTags).toBe(true);
        act(() => {
            result.current.toggleShowTags();
        });
        expect(result.current.showTags).toBe(false);
        // Persisted under the legacy taiga.generateHash key, JSON-encoded.
        expect(window.localStorage.getItem(SHOW_TAGS_KEY_7)).toBe("false");
        // The pre-migration React-namespaced key must NOT be used.
        expect(window.localStorage.getItem(LEGACY_REACT_SHOWTAGS_KEY)).toBeNull();
    });

    it("toggleActiveFilters flips", async () => {
        const { result } = await renderLoaded();
        expect(result.current.activeFilters).toBe(false);
        act(() => {
            result.current.toggleActiveFilters();
        });
        expect(result.current.activeFilters).toBe(true);
    });

    it("toggleVelocityForecasting flips in-memory and is EPHEMERAL (never persisted)", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleVelocityForecasting();
        });
        expect(result.current.displayVelocity).toBe(true);
        // M5: displayVelocity must NOT be written to localStorage under any key.
        expect(window.localStorage.getItem(LEGACY_REACT_VELOCITY_KEY)).toBeNull();
        expect(window.localStorage.length).toBe(0);
    });

    it("velocity forecasting collapses the backlog to the stories that fit the next sprint", async () => {
        // Five backlog stories, 4 points each. Velocity (speed) = 10 and the first
        // open sprint contributes 0 points, so the running sum crosses 10 after the
        // third story (4+4+4 = 12 > 10). Legacy `calculateForecasting` keeps the
        // overflowing story and stops, so forecasting shows the leading THREE.
        listUnassignedUserStories.mockResolvedValue(
            page([
                us(10, { backlog_order: 1, total_points: 4 }),
                us(11, { backlog_order: 2, total_points: 4 }),
                us(12, { backlog_order: 3, total_points: 4 }),
                us(13, { backlog_order: 4, total_points: 4 }),
                us(14, { backlog_order: 5, total_points: 4 }),
            ]),
        );
        getProjectStats.mockResolvedValue(statsFixture({ speed: 10 }));
        // Seed the accumulation with a zero-point open sprint so the reduction is
        // driven purely by the backlog points.
        listMilestones.mockImplementation((_pid: number, filters?: { closed?: boolean }) =>
            Promise.resolve(
                filters?.closed
                    ? { milestones: [sprint(6, { closed: true, total_points: 5, closed_points: 5 })], closed: 1, open: 0 }
                    : { milestones: [sprint(5, { total_points: 0 })], closed: 1, open: 1 },
            ),
        );

        const { result } = await renderLoaded();

        // Off by default: every fetched story renders; the total count is 5.
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11, 12, 13, 14]);
        expect(result.current.totalUserStories).toBe(5);

        act(() => {
            result.current.toggleVelocityForecasting();
        });

        // On: collapsed to the leading stories within velocity (3 of 5). The
        // authoritative total is unchanged — only the VISIBLE projection shrinks.
        expect(result.current.displayVelocity).toBe(true);
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11, 12]);
        expect(result.current.totalUserStories).toBe(5);

        // Toggling back off restores the full list.
        act(() => {
            result.current.toggleVelocityForecasting();
        });
        expect(result.current.displayVelocity).toBe(false);
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11, 12, 13, 14]);
    });

    it("velocity forecasting does not reduce the backlog when there is no velocity (speed 0)", async () => {
        // Without a known velocity the legacy loop never breaks, so every story
        // stays visible even with forecasting toggled on (and the enable control is
        // hidden in the view — see Backlog.tsx).
        listUnassignedUserStories.mockResolvedValue(
            page([
                us(10, { backlog_order: 1, total_points: 4 }),
                us(11, { backlog_order: 2, total_points: 4 }),
                us(12, { backlog_order: 3, total_points: 4 }),
            ]),
        );
        getProjectStats.mockResolvedValue(statsFixture({ speed: 0 }));

        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleVelocityForecasting();
        });
        expect(result.current.displayVelocity).toBe(true);
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11, 12]);
    });

    it("toggleClosedSprints loads closed sprints on, clears them off", async () => {
        const { result } = await renderLoaded();
        listMilestones.mockClear();
        act(() => {
            result.current.toggleClosedSprints();
        });
        expect(result.current.closedSprintsVisible).toBe(true);
        await waitFor(() => expect(listMilestones).toHaveBeenCalledWith(7, { closed: true }));
        await waitFor(() => expect(result.current.closedSprints.length).toBeGreaterThan(0));
        act(() => {
            result.current.toggleClosedSprints();
        });
        expect(result.current.closedSprintsVisible).toBe(false);
        expect(result.current.closedSprints.length).toBe(0);
    });

    it("changeQ updates the query and triggers a debounced reload", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.changeQ("bug");
        });
        expect(result.current.filterQ).toBe("bug");
        listUnassignedUserStories.mockClear();
        jest.useFakeTimers();
        act(() => {
            jest.advanceTimersByTime(600);
        });
        jest.useRealTimers();
        await waitFor(() =>
            expect(listUnassignedUserStories).toHaveBeenCalledWith(
                7,
                expect.objectContaining({ q: "bug" }),
                undefined,
            ),
        );
    });

    it("loadUserstories can be invoked directly", async () => {
        const { result } = await renderLoaded();
        listUnassignedUserStories.mockClear();
        act(() => {
            result.current.loadUserstories();
        });
        await waitFor(() => expect(listUnassignedUserStories).toHaveBeenCalled());
    });
});

/* --------------------------------------------------------------------------- *
 * Filters (C4) — the full legacy backlog filter contract.
 *
 * The hook reproduces `BacklogController.generateFilters` + `FiltersMixin` /
 * `UsFiltersMixin`: it fetches the category data from the frozen
 * `getUserStoriesFilters` endpoint, builds the six category panels
 * (status/tags/assigned_to/role/created_by/epic), projects applied chips from an
 * `appliedParams` URL-style params object, persists that object to the legacy
 * hashed `backlog-filters` localStorage key, coalesces a debounced list reload
 * that carries the params, and reads/writes named custom filters through the
 * frozen `user-storage` endpoint (`getUserFilters`/`storeUserFilters`). Applied
 * params hydrate on mount from the URL query, falling back to the persisted
 * `backlog-filters` entry when the URL carries none.
 * --------------------------------------------------------------------------- */

describe("filters (C4)", () => {
    /** The legacy persisted applied-filter key for slug "p1". */
    const BACKLOG_FILTERS_KEY_P1 = generateHash(["p1", "p1:backlog-filters"]);

    /**
     * A faithful in-memory model of the `user-storage` endpoint: `getUserFilters`
     * returns a fresh copy of the store (so the hook may mutate it locally) and
     * `storeUserFilters` writes the map back — modelling the GET/PUT round-trip
     * the legacy `FilterRemoteStorageService` performs.
     */
    function installStatefulUserStorage(seed: Record<string, unknown> = {}): {
        current: () => Record<string, unknown>;
    } {
        let store: Record<string, unknown> = { ...seed };
        getUserFilters.mockImplementation(async () => ({ ...store }));
        storeUserFilters.mockImplementation(async (_pid: number, filters: Record<string, unknown>) => {
            store = { ...filters };
        });
        return { current: () => store };
    }

    /** Read + parse the persisted backlog-filters params (or `null`). */
    function storedParams(): Record<string, string> | null {
        const raw = window.localStorage.getItem(BACKLOG_FILTERS_KEY_P1);
        return raw === null ? null : (JSON.parse(raw) as Record<string, string>);
    }

    // Isolate the browser URL: several tests drive mount hydration off the query
    // string, so reset it to a bare path before and after each case.
    beforeEach(() => {
        window.history.pushState({}, "", "/");
    });
    afterEach(() => {
        window.history.pushState({}, "", "/");
    });

    it("builds the six category panels from the filters endpoint on mount", async () => {
        const { result } = await renderLoaded();

        // regenerateFilters fetched the category data with the backlog list scope.
        expect(getUserStoriesFilters).toHaveBeenCalledWith(
            expect.objectContaining({ project: 7, milestone: "null" }),
        );
        // Six panels, translated titles, in the legacy category order.
        expect(result.current.filters.map((f) => f.dataType)).toEqual([
            "status",
            "tags",
            "assigned_users",
            "role",
            "owner",
            "epic",
        ]);
        const statusPanel = result.current.filters.find((f) => f.dataType === "status");
        expect(statusPanel?.title).toBe("Status");
        // The fixture status option surfaced (id coerced to string).
        expect(statusPanel?.content).toEqual([
            expect.objectContaining({ id: "1", name: "New" }),
        ]);
        // No chips applied on the happy default mount.
        expect(result.current.selectedFilters).toEqual([]);
    });

    it("loads the persisted custom filters from the user-storage endpoint on mount", async () => {
        getUserFilters.mockResolvedValueOnce({ "My saved": { status: "1" } });
        const { result } = await renderLoaded();

        expect(getUserFilters).toHaveBeenCalledWith(7, "backlog-custom-filters");
        expect(result.current.customFilters).toEqual([
            { id: "My saved", name: "My saved", filter: { status: "1" } },
        ]);
    });

    it("addFilter selects a category value: adds a chip, persists to backlog-filters, and reloads with the grouped param", async () => {
        const { result } = await renderLoaded();
        listUnassignedUserStories.mockClear();

        await act(async () => {
            result.current.addFilter({ category: { dataType: "status" }, filter: { id: 1 } });
        });

        // Chip projected synchronously from the cached category data.
        expect(result.current.selectedFilters).toEqual([
            expect.objectContaining({
                dataType: "status",
                id: "1",
                name: "New",
                mode: "include",
                key: "status:1",
            }),
        ]);
        // Persisted to the LEGACY hashed backlog-filters key as JSON.
        expect(storedParams()).toEqual({ status: "1" });
        // Debounced list reload carries the grouped param (real ≤500ms debounce).
        await waitFor(() =>
            expect(listUnassignedUserStories).toHaveBeenCalledWith(
                7,
                expect.objectContaining({ status: "1" }),
                undefined,
            ),
        );
    });

    it("addFilter in exclude mode uses the exclude_ param name", async () => {
        const { result } = await renderLoaded();
        listUnassignedUserStories.mockClear();

        await act(async () => {
            result.current.addFilter({
                category: { dataType: "status" },
                filter: { id: 2 },
                mode: "exclude",
            });
        });

        expect(result.current.selectedFilters).toEqual([
            expect.objectContaining({ dataType: "status", id: "2", mode: "exclude" }),
        ]);
        expect(storedParams()).toEqual({ exclude_status: "2" });
        await waitFor(() =>
            expect(listUnassignedUserStories).toHaveBeenCalledWith(
                7,
                expect.objectContaining({ exclude_status: "2" }),
                undefined,
            ),
        );
    });

    it("multiple values in one category coalesce into a comma-joined, de-duplicated param", async () => {
        getUserStoriesFilters.mockResolvedValue({
            statuses: [
                { id: 1, name: "New" },
                { id: 2, name: "Done" },
            ],
        });
        const { result } = await renderLoaded();
        listUnassignedUserStories.mockClear();

        await act(async () => {
            result.current.addFilter({ category: { dataType: "status" }, filter: { id: 1 } });
        });
        await act(async () => {
            result.current.addFilter({ category: { dataType: "status" }, filter: { id: 2 } });
        });
        // Adding the same value again must not duplicate it (legacy uniq).
        await act(async () => {
            result.current.addFilter({ category: { dataType: "status" }, filter: { id: 1 } });
        });

        expect(storedParams()).toEqual({ status: "1,2" });
        expect(
            result.current.selectedFilters.filter((c) => c.dataType === "status").map((c) => c.id),
        ).toEqual(["1", "2"]);
        // Flush the trailing coalesced reload.
        await waitFor(() =>
            expect(listUnassignedUserStories).toHaveBeenCalledWith(
                7,
                expect.objectContaining({ status: "1,2" }),
                undefined,
            ),
        );
    });

    it("removeFilter removes the chip and deletes the now-empty param", async () => {
        const { result } = await renderLoaded();
        await act(async () => {
            result.current.addFilter({ category: { dataType: "status" }, filter: { id: 1 } });
        });
        expect(result.current.selectedFilters).toHaveLength(1);
        const chip = result.current.selectedFilters[0];

        listUnassignedUserStories.mockClear();
        await act(async () => {
            result.current.removeFilter(chip);
        });

        expect(result.current.selectedFilters).toEqual([]);
        // The empty category key is deleted, not left as "".
        expect(storedParams()).toEqual({});
        await waitFor(() => expect(listUnassignedUserStories).toHaveBeenCalled());
        const lastCall =
            listUnassignedUserStories.mock.calls[listUnassignedUserStories.mock.calls.length - 1][1];
        expect(lastCall).not.toHaveProperty("status");
    });

    it("saveCustomFilter persists the current applied params to user-storage and refreshes the saved list", async () => {
        const storage = installStatefulUserStorage();
        const { result } = await renderLoaded();
        await act(async () => {
            result.current.addFilter({ category: { dataType: "status" }, filter: { id: 1 } });
        });

        await act(async () => {
            result.current.saveCustomFilter("Sprint work");
        });

        // Wrote only the category params (never `q`) under the name.
        await waitFor(() =>
            expect(storeUserFilters).toHaveBeenCalledWith(
                7,
                expect.objectContaining({ "Sprint work": { status: "1" } }),
                "backlog-custom-filters",
            ),
        );
        // Reloaded from the endpoint -> the saved filter is now in the VM.
        await waitFor(() =>
            expect(result.current.customFilters).toEqual([
                { id: "Sprint work", name: "Sprint work", filter: { status: "1" } },
            ]),
        );
        expect(storage.current()).toEqual({ "Sprint work": { status: "1" } });
    });

    it("saveCustomFilter ignores a blank name (no persistence)", async () => {
        installStatefulUserStorage();
        const { result } = await renderLoaded();
        storeUserFilters.mockClear();
        await act(async () => {
            result.current.saveCustomFilter("   ");
        });
        expect(storeUserFilters).not.toHaveBeenCalled();
    });

    it("removeCustomFilter deletes the saved filter from user-storage and refreshes the list", async () => {
        const storage = installStatefulUserStorage({ Alpha: { status: "1" }, Beta: { tags: "x" } });
        const { result } = await renderLoaded();
        expect(result.current.customFilters.map((c) => c.id).sort()).toEqual(["Alpha", "Beta"]);

        await act(async () => {
            result.current.removeCustomFilter({ id: "Alpha", name: "Alpha", filter: { status: "1" } });
        });

        await waitFor(() =>
            expect(result.current.customFilters.map((c) => c.id)).toEqual(["Beta"]),
        );
        expect(storage.current()).toEqual({ Beta: { tags: "x" } });
    });

    it("selectCustomFilter replaces all applied params and persists + reloads with them", async () => {
        const { result } = await renderLoaded();
        listUnassignedUserStories.mockClear();

        await act(async () => {
            result.current.selectCustomFilter({
                id: "Saved",
                name: "Saved",
                filter: { status: "1", exclude_tags: "foo" },
            });
        });

        // The whole applied set is replaced by the saved filter's params.
        expect(storedParams()).toEqual({ status: "1", exclude_tags: "foo" });
        expect(
            result.current.selectedFilters.some((c) => c.dataType === "status" && c.id === "1"),
        ).toBe(true);
        await waitFor(() =>
            expect(listUnassignedUserStories).toHaveBeenCalledWith(
                7,
                expect.objectContaining({ status: "1", exclude_tags: "foo" }),
                undefined,
            ),
        );
    });

    it("hydrates applied filters from the URL query on mount (chips + first list request)", async () => {
        window.history.pushState({}, "", "/?status=1&exclude_tags=foo&bogus=nope");
        const { result } = await renderLoaded();

        // Only VALID_QUERY_PARAMS are picked; the first list load already carries them.
        expect(listUnassignedUserStories).toHaveBeenCalledWith(
            7,
            expect.objectContaining({ status: "1", exclude_tags: "foo" }),
            undefined,
        );
        const firstCall = listUnassignedUserStories.mock.calls[0][1];
        expect(firstCall).not.toHaveProperty("bogus");
        // Chips projected from the hydrated params.
        expect(
            result.current.selectedFilters.some((c) => c.dataType === "status" && c.id === "1"),
        ).toBe(true);
    });

    it("falls back to the persisted backlog-filters entry when the URL carries no query", async () => {
        window.localStorage.setItem(
            BACKLOG_FILTERS_KEY_P1,
            JSON.stringify({ status: "2", q: "ignored" }),
        );
        const { result } = await renderLoaded();

        // `q` is dropped (legacy getFilters), only valid params applied.
        expect(listUnassignedUserStories).toHaveBeenCalledWith(
            7,
            expect.objectContaining({ status: "2" }),
            undefined,
        );
        const firstCall = listUnassignedUserStories.mock.calls[0][1];
        expect(firstCall.q).toBe("");
        expect(result.current.errorMessage).toBeNull();
    });

    it("surfaces a sanitized error when the filter-data fetch rejects but keeps the screen usable", async () => {
        // Mount succeeds; a later regenerate (triggered by an applied filter) fails.
        const { result } = await renderLoaded();
        getUserStoriesFilters.mockRejectedValueOnce(new Error("filters down"));

        await act(async () => {
            result.current.addFilter({ category: { dataType: "status" }, filter: { id: 1 } });
        });

        await waitFor(() => expect(result.current.errorMessage).toBe(GENERIC_ERROR));
        // The chip was still applied optimistically (screen stays usable).
        expect(result.current.selectedFilters).toHaveLength(1);
        // Flush the trailing debounced reload so no update escapes act().
        await waitFor(() => expect(listUnassignedUserStories).toHaveBeenCalled());
    });
});

/* --------------------------------------------------------------------------- *
 * WebSocket subscription effect
 * --------------------------------------------------------------------------- */

describe("websocket subscription", () => {
    it("subscribes to the project and reloads on the userstories key", async () => {
        await renderLoaded();
        expect(mockedSubscribeToProject).toHaveBeenCalledWith(
            fakeEvents,
            7,
            expect.objectContaining({
                onUserStories: expect.any(Function),
                onMilestones: expect.any(Function),
            }),
        );
        listUnassignedUserStories.mockClear();
        listMilestones.mockClear();
        jest.useFakeTimers();
        act(() => {
            capturedHandlers.onUserStories?.(undefined);
            jest.advanceTimersByTime(1100);
        });
        jest.useRealTimers();
        await waitFor(() => expect(listUnassignedUserStories).toHaveBeenCalled());
        await waitFor(() => expect(listMilestones).toHaveBeenCalled());
    });

    it("reloads sprints + closed sprints + authoritative stats on the milestones key", async () => {
        await renderLoaded();
        listMilestones.mockClear();
        getProjectStats.mockClear();
        jest.useFakeTimers();
        act(() => {
            capturedHandlers.onMilestones?.(undefined);
            jest.advanceTimersByTime(1100);
        });
        jest.useRealTimers();
        await waitFor(() =>
            expect(listMilestones).toHaveBeenCalledWith(7, { closed: false }),
        );
        await waitFor(() =>
            expect(listMilestones).toHaveBeenCalledWith(7, { closed: true }),
        );
        await waitFor(() => expect(getProjectStats).toHaveBeenCalled());
    });

    it("tears the subscription down on unmount", async () => {
        const view = await renderLoaded();
        view.unmount();
        expect(capturedCleanup).toHaveBeenCalled();
        expect(stop).toHaveBeenCalled();
    });
});


/* -------------------------------------------------------------------------- */
/* M22 — localized page <title>/<meta description> on load + unmount cleanup   */
/* (shares shared/meta/appMeta.ts with the Kanban screen).                     */
/* -------------------------------------------------------------------------- */
describe("useBacklogStories — page metadata (M22)", () => {
    let headHtml: string;

    beforeEach(() => {
        // Preserve and seed the <head> the way index.jade ships it (a <title>).
        headHtml = document.head.innerHTML;
        document.head.innerHTML = "<title>Taiga</title>";
    });

    afterEach(() => {
        document.head.innerHTML = headHtml;
    });

    it("sets the localized Backlog title + description once the project loads", async () => {
        getProjectBySlug.mockResolvedValueOnce(
            project({ name: "Alpha", description: "the alpha backlog" }),
        );

        const { result } = renderHook(() => useBacklogStories(context));
        await waitFor(() => expect(result.current.loading).toBe(false));

        // BACKLOG.PAGE_TITLE = "Backlog - {{projectName}}".
        expect(document.head.querySelector("title")?.textContent).toBe("Backlog - Alpha");
        // BACKLOG.PAGE_DESCRIPTION interpolates name + description.
        const desc = document.head
            .querySelector("meta[name='description']")
            ?.getAttribute("content");
        expect(desc).toBe(
            "The backlog panel, with user stories and sprints of the project Alpha: the alpha backlog",
        );
        // The open-graph block is written too (full setAll parity).
        expect(
            document.head.querySelector("meta[property='og:title']")?.getAttribute("content"),
        ).toBe("Backlog - Alpha");
    });

    it("restores the prior <head> tags on unmount (no stale title leak)", async () => {
        getProjectBySlug.mockResolvedValueOnce(
            project({ name: "Alpha", description: "the alpha backlog" }),
        );

        const { result, unmount } = renderHook(() => useBacklogStories(context));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(document.head.querySelector("title")?.textContent).toBe("Backlog - Alpha");
        expect(document.head.querySelector("meta[property='og:title']")).not.toBeNull();

        act(() => {
            unmount();
        });

        // Title restored; the screen-created og/twitter tags removed.
        expect(document.head.querySelector("title")?.textContent).toBe("Taiga");
        expect(document.head.querySelector("meta[property='og:title']")).toBeNull();
        expect(document.head.querySelector("meta[name='twitter:card']")).toBeNull();
    });

    it("does not set a Backlog title when the initial project load fails", async () => {
        getProjectBySlug.mockRejectedValueOnce(new ApiError(500, { _error_message: "boom" }));

        const { result } = renderHook(() => useBacklogStories(context));
        await waitFor(() => expect(result.current.loading).toBe(false));

        // project stayed null -> no metadata written (parity with onInitialDataError).
        expect(document.head.querySelector("title")?.textContent).toBe("Taiga");
        expect(document.head.querySelector("meta[property='og:title']")).toBeNull();
    });
});

/* --------------------------------------------------------------------------- *
 * M9 — operation-generation guard (ignore superseded completions / rollbacks) *
 * --------------------------------------------------------------------------- */

describe("useBacklogStories — operation generation (M9, CWE-362)", () => {
    it("a delete rollback that settles AFTER a slug-change reload is ignored", async () => {
        // Deferred remove so we can settle it only AFTER the board reloads.
        const removeD = deferred<void>();
        remove.mockReturnValueOnce(removeD.promise);

        const view = renderHook((ctx: MountContext) => useBacklogStories(ctx), {
            initialProps: context,
        });
        await waitFor(() => expect(view.result.current.loading).toBe(false));
        expect(view.result.current.userstories.map((u) => u.id)).toEqual([10, 11]);

        // Confirm-delete 10 -> optimistic removal + a pending remove() request.
        act(() => {
            view.result.current.deleteUserStory(us(10));
        });
        await act(async () => {
            view.result.current.confirmDelete();
        });
        expect(view.result.current.userstories.map((u) => u.id)).toEqual([11]);

        // Slug change -> firstLoad cleanup bumps the generation and reloads a
        // DIFFERENT backlog (10 legitimately absent on the new board).
        listUnassignedUserStories.mockResolvedValue(page([us(50), us(51)]));
        await act(async () => {
            view.rerender({ ...context, projectSlug: "p2" });
        });
        await waitFor(() =>
            expect(view.result.current.userstories.map((u) => u.id)).toEqual([50, 51]),
        );

        // The stale delete now FAILS: its rollback + error MUST be ignored so
        // the reloaded board is not corrupted and no stale error surfaces.
        await act(async () => {
            removeD.reject(new ApiError(500, { _error_message: "stale delete failed" }));
            await Promise.resolve();
        });
        expect(view.result.current.errorMessage).toBeNull();
        expect(view.result.current.userstories.map((u) => u.id)).toEqual([50, 51]);
    });

    it("a create that resolves AFTER a slug-change reload does not reload the new board", async () => {
        // Deferred create so it settles only AFTER the board reloads.
        const createD = deferred<UserStory>();
        create.mockReturnValueOnce(createD.promise);

        const view = renderHook((ctx: MountContext) => useBacklogStories(ctx), {
            initialProps: context,
        });
        await waitFor(() => expect(view.result.current.loading).toBe(false));

        // Open the create lightbox + submit -> pending create().
        act(() => {
            view.result.current.addNewUs("standard");
        });
        await act(async () => {
            view.result.current.submitNewUs(
                createEmptyStoryValues({ subject: "late story", status: 1 }),
            );
        });

        // Reload (new slug) before the create resolves.
        listUnassignedUserStories.mockResolvedValue(page([us(50), us(51)]));
        await act(async () => {
            view.rerender({ ...context, projectSlug: "p2" });
        });
        await waitFor(() =>
            expect(view.result.current.userstories.map((u) => u.id)).toEqual([50, 51]),
        );

        // The stale create's post-create reload (loadUserstories) MUST be
        // skipped by the generation guard, so listUnassignedUserStories is NOT called
        // again and no stale error surfaces.
        const callsBefore = listUnassignedUserStories.mock.calls.length;
        await act(async () => {
            createD.resolve(us(999, { subject: "late story" }));
            await Promise.resolve();
        });
        expect(listUnassignedUserStories.mock.calls.length).toBe(callsBefore);
        expect(view.result.current.errorMessage).toBeNull();
        expect(view.result.current.userstories.map((u) => u.id)).toEqual([50, 51]);
    });
});

/* --------------------------------------------------------------------------- *
 * C6 — edit fetches AUTHORITATIVE by-id detail + attachments BEFORE opening    *
 * --------------------------------------------------------------------------- */

describe("useBacklogStories — edit fetches authoritative detail (C6)", () => {
    it("fetches detail + attachments, reconciles into projections, then opens", async () => {
        const { result } = await renderLoaded();
        // The list projection for 11 omits the description.
        expect(
            result.current.userstories.find((u) => u.id === 11)?.description,
        ).toBeUndefined();

        // The authoritative detail carries the REAL description + version + attachments.
        getUserStory.mockResolvedValueOnce(
            us(11, { description: "authoritative body", version: 9 }),
        );
        const att = [{ id: 1, name: "spec.pdf" }];
        listUserStoryAttachments.mockResolvedValueOnce(att);

        await act(async () => {
            result.current.editUserStory(us(11));
        });

        // Detail + attachments fetched BEFORE the lightbox opened.
        expect(getUserStory).toHaveBeenCalledWith(7, 11);
        expect(listUserStoryAttachments).toHaveBeenCalledWith(7, 11);
        await waitFor(() =>
            expect(result.current.activeLightbox).toEqual({ type: "edit", usId: 11 }),
        );
        // The authoritative detail was reconciled into the backlog projection so
        // the form seeds the REAL description (not a blank that a save would PATCH away).
        const reconciled = result.current.userstories.find((u) => u.id === 11);
        expect(reconciled?.description).toBe("authoritative body");
        expect(reconciled?.version).toBe(9);
        expect(reconciled?.attachments).toEqual(att);
        expect(result.current.editLoading).toBe(false);
    });

    it("does NOT open a blank form when the detail fetch fails (FATAL)", async () => {
        const { result } = await renderLoaded();
        getUserStory.mockRejectedValueOnce(new ApiError(500, { _error_message: "boom" }));

        await act(async () => {
            result.current.editUserStory(us(11));
        });

        // No lightbox opened; a sanitized error surfaced; loading released.
        expect(result.current.activeLightbox).toBeNull();
        expect(result.current.errorMessage).not.toBeNull();
        expect(result.current.editLoading).toBe(false);
    });

    it("opens even when the attachments fetch fails (NON-FATAL, degrades to [])", async () => {
        const { result } = await renderLoaded();
        getUserStory.mockResolvedValueOnce(us(11, { description: "body" }));
        listUserStoryAttachments.mockRejectedValueOnce(
            new ApiError(500, { _error_message: "no attachments" }),
        );

        await act(async () => {
            result.current.editUserStory(us(11));
        });

        await waitFor(() =>
            expect(result.current.activeLightbox).toEqual({ type: "edit", usId: 11 }),
        );
        const reconciled = result.current.userstories.find((u) => u.id === 11);
        expect(reconciled?.description).toBe("body");
        expect(reconciled?.attachments).toEqual([]);
    });

    it("re-open guard ignores a second click while the first detail fetch is in flight", async () => {
        const { result } = await renderLoaded();
        const d = deferred<UserStory>();
        getUserStory.mockReturnValueOnce(d.promise);

        act(() => {
            result.current.editUserStory(us(11));
        });
        // Second click while loading -> ignored (no duplicate fetch).
        act(() => {
            result.current.editUserStory(us(10));
        });
        expect(getUserStory).toHaveBeenCalledTimes(1);

        await act(async () => {
            d.resolve(us(11, { description: "body" }));
            await Promise.resolve();
        });
        await waitFor(() =>
            expect(result.current.activeLightbox).toEqual({ type: "edit", usId: 11 }),
        );
    });

    it("discards a superseded edit-open (detail resolves AFTER a slug-change reload)", async () => {
        const d = deferred<UserStory>();
        getUserStory.mockReturnValueOnce(d.promise);

        const view = renderHook((ctx: MountContext) => useBacklogStories(ctx), {
            initialProps: context,
        });
        await waitFor(() => expect(view.result.current.loading).toBe(false));

        act(() => {
            view.result.current.editUserStory(us(11));
        });

        // Slug change -> generation bump + reload before the detail resolves.
        await act(async () => {
            view.rerender({ ...context, projectSlug: "p2" });
        });
        await waitFor(() => expect(view.result.current.loading).toBe(false));

        // Stale detail resolves -> the edit-open MUST be discarded (no lightbox).
        await act(async () => {
            d.resolve(us(11, { description: "stale" }));
            await Promise.resolve();
        });
        expect(view.result.current.activeLightbox).toBeNull();
        expect(view.result.current.errorMessage).toBeNull();
    });
});

/* --------------------------------------------------------------------------- *
 * M2 — authoritative pagination + total headers                               *
 * --------------------------------------------------------------------------- */

describe("useBacklogStories — authoritative pagination (M2)", () => {
    it("uses the AUTHORITATIVE Taiga-Info-Backlog-Total-Userstories total, not the loaded-row count", async () => {
        // Only 2 rows loaded, but the backend reports 42 total in the backlog.
        listUnassignedUserStories.mockResolvedValue(
            page([us(10), us(11)], { backlogTotal: 42, hasNext: true }),
        );
        const { result } = await renderLoaded();
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11]);
        // The DEFECT this fixes: total was `list.length` (2); it must be 42.
        expect(result.current.totalUserStories).toBe(42);
        expect(result.current.hasMoreUserstories).toBe(true);
    });

    it("calls the paginated listUnassignedUserStories on mount (page 1, no x-disable-pagination)", async () => {
        await renderLoaded();
        expect(listUnassignedUserStories).toHaveBeenCalledWith(
            7,
            expect.objectContaining({ page: 1 }),
            undefined,
        );
    });

    it("loadMoreUserstories fetches the NEXT page and APPENDS (page advancement)", async () => {
        listUnassignedUserStories
            .mockResolvedValueOnce(page([us(10), us(11)], { backlogTotal: 4, hasNext: true }))
            .mockResolvedValueOnce(page([us(12), us(13)], { backlogTotal: 4, hasNext: false }));

        const { result } = await renderLoaded();
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11]);
        expect(result.current.hasMoreUserstories).toBe(true);

        await act(async () => {
            result.current.loadMoreUserstories();
        });

        // Page 2 was requested and its rows appended; no more pages remain.
        expect(listUnassignedUserStories).toHaveBeenLastCalledWith(
            7,
            expect.objectContaining({ page: 2 }),
            undefined,
        );
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11, 12, 13]);
        expect(result.current.hasMoreUserstories).toBe(false);
    });

    it("loadMoreUserstories DEDUPES an overlapping row (WS/optimistic-safe append)", async () => {
        listUnassignedUserStories
            .mockResolvedValueOnce(page([us(10), us(11)], { backlogTotal: 3, hasNext: true }))
            // Page 2 overlaps id 11 (e.g. a re-fetched range) -> must not duplicate.
            .mockResolvedValueOnce(page([us(11), us(12)], { backlogTotal: 3, hasNext: false }));

        const { result } = await renderLoaded();
        await act(async () => {
            result.current.loadMoreUserstories();
        });
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11, 12]);
    });

    it("loadMoreUserstories is a no-op when there is no next page", async () => {
        listUnassignedUserStories.mockResolvedValue(
            page([us(10), us(11)], { hasNext: false }),
        );
        const { result } = await renderLoaded();
        listUnassignedUserStories.mockClear();
        await act(async () => {
            result.current.loadMoreUserstories();
        });
        expect(listUnassignedUserStories).not.toHaveBeenCalled();
    });

    it("a post-mutation reload preserves the loaded page depth (reloadLoadedUserstories page_size)", async () => {
        // Load two pages first (4 rows shown).
        listUnassignedUserStories
            .mockResolvedValueOnce(page([us(10), us(11)], { backlogTotal: 4, hasNext: true }))
            .mockResolvedValueOnce(page([us(12), us(13)], { backlogTotal: 4, hasNext: false }));
        const { result } = await renderLoaded();
        await act(async () => {
            result.current.loadMoreUserstories();
        });
        expect(result.current.userstories).toHaveLength(4);

        // A create triggers reloadLoadedUserstories: it must refetch ALL loaded
        // rows in ONE page (page_size = 4), not shrink back to page 1.
        listUnassignedUserStories.mockClear();
        listUnassignedUserStories.mockResolvedValue(
            page([us(10), us(11), us(12), us(13)], { backlogTotal: 4, hasNext: false }),
        );
        act(() => {
            result.current.addNewUs("standard");
        });
        await act(async () => {
            result.current.submitNewUs(createEmptyStoryValues({ subject: "New" }));
        });
        await waitFor(() => expect(create).toHaveBeenCalled());
        await waitFor(() =>
            expect(listUnassignedUserStories).toHaveBeenCalledWith(
                7,
                expect.objectContaining({ page: 1 }),
                4,
            ),
        );
    });
});
