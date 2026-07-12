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
 * drag / reorder / reconcile math is validated end-to-end.
 *
 * Coverage targets: mount + all loaders, every VM action (including the
 * coalesced multi-drag drain, the mandated rollback, and the
 * events-disconnected fallback), the WebSocket subscription effect, the
 * AngularJS<->React US-lightbox bridge, and the module-scope helpers
 * (runtime-project window bridge + graceful fallback, date parsing, stats
 * derivation, localStorage prefs).
 */

import { act, renderHook, waitFor } from "@testing-library/react";

import { useBacklogStories } from "./useBacklogStories";
import type { BacklogVM } from "./useBacklogStories";
import type { Milestone, MountContext, UserStory } from "../../shared/types";
import type { ApiClient } from "../../shared/api";
import type { EventsClient, ProjectEventHandlers } from "../../shared/ws/events";
import { createApiClient } from "../../shared/api";
import { createEventsClient, subscribeToProject } from "../../shared/ws/events";

jest.mock("../../shared/api", () => ({ createApiClient: jest.fn() }));
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

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
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

const resolveProject = jest.fn();
const getUserStoriesFilters = jest.fn();
const listUserStories = jest.fn();
const listMilestones = jest.fn();
const bulkUpdateBacklogOrder = jest.fn();
const bulkUpdateMilestone = jest.fn();
const save = jest.fn();
const remove = jest.fn();

const fakeClient = {
    resolveProject,
    getUserStoriesFilters,
    listUserStories,
    listMilestones,
    bulkUpdateBacklogOrder,
    bulkUpdateMilestone,
    save,
    remove,
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
 * Window runtime-project helpers (the single intentional cross-framework seam)
 * --------------------------------------------------------------------------- */

type MutableWindow = typeof window & {
    taigaConfig?: { project?: unknown };
    _project?: unknown;
    taigaCurrentProject?: unknown;
};

function runtimeProject(over: Record<string, unknown> = {}): Record<string, unknown> {
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
        total_story_points: 10,
        total_milestones: 2,
        total_closed_milestones: 1,
        ...over,
    };
}

function setRuntimeProject(project: unknown): void {
    (window as MutableWindow).taigaConfig = { project };
}

function clearRuntimeProject(): void {
    delete (window as MutableWindow).taigaConfig;
    delete (window as MutableWindow)._project;
    delete (window as MutableWindow).taigaCurrentProject;
}

/* --------------------------------------------------------------------------- *
 * Lifecycle
 * --------------------------------------------------------------------------- */

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    clearRuntimeProject();
    setRuntimeProject(runtimeProject());

    resolveProject.mockResolvedValue(7);
    getUserStoriesFilters.mockResolvedValue({ statuses: [{ id: 1, name: "New" }] });
    listUserStories.mockResolvedValue([us(10), us(11)]);
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

    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
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
 * Mount + loaders
 * --------------------------------------------------------------------------- */

describe("mount + initial load", () => {
    it("resolves the project, loads sprints/userstories/statuses and exposes the full VM", async () => {
        const { result } = await renderLoaded();

        expect(resolveProject).toHaveBeenCalledWith("p1");
        expect(result.current.projectId).toBe(7);
        expect(result.current.project?.id).toBe(7);
        // userstories sorted by backlog_order.
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11]);
        expect(result.current.totalUserStories).toBe(2);
        expect(result.current.sprints.map((s) => s.id)).toEqual([5]);
        expect(result.current.totalMilestones).toBe(2);
        expect(result.current.totalClosedMilestones).toBe(1);
        // us_statuses came from the runtime project.
        expect(result.current.statuses.map((s) => s.id)).toEqual([1, 2]);
        // stats derived from milestones + runtime totals.
        expect(result.current.stats).not.toBeNull();
        expect(result.current.stats?.closed_points).toBe(3);
        // findCurrentSprint matches the wide-range sprint.
        expect(result.current.currentSprint?.id).toBe(5);
        // WS wired.
        expect(result.current.eventsConnected).toBe(true);
        expect(setupConnection).toHaveBeenCalledTimes(1);
        // localStorage-hydrated prefs (defaults).
        expect(result.current.showTags).toBe(true);
        expect(result.current.displayVelocity).toBe(false);
    });

    it("uses the filters endpoint for statuses when the runtime project has none", async () => {
        setRuntimeProject(runtimeProject({ us_statuses: [] }));
        const { result } = await renderLoaded();
        expect(getUserStoriesFilters).toHaveBeenCalledWith({ project: 7 });
        expect(result.current.statuses.map((s) => s.id)).toEqual([1]);
    });

    it("falls back to a synthetic project when no window global is present", async () => {
        clearRuntimeProject();
        const { result } = await renderLoaded();
        expect(result.current.project?.my_permissions).toEqual([]);
        // Fallback keeps the backlog activated so the screen still renders.
        expect(result.current.isBacklogActivated).toBe(true);
        // Empty permissions => everything gated off.
        expect(result.current.hasPermission("modify_us")).toBe(false);
    });

    it("reads the runtime project from the _project global", async () => {
        clearRuntimeProject();
        (window as MutableWindow)._project = runtimeProject({ name: "via _project" });
        const { result } = await renderLoaded();
        expect(result.current.project?.name).toBe("via _project");
    });

    it("reads the runtime project from the taigaCurrentProject global", async () => {
        clearRuntimeProject();
        (window as MutableWindow).taigaCurrentProject = runtimeProject({ name: "via current" });
        const { result } = await renderLoaded();
        expect(result.current.project?.name).toBe("via current");
    });

    it("still clears loading when the initial load throws", async () => {
        resolveProject.mockRejectedValueOnce(new Error("network down"));
        const { result } = renderHook(() => useBacklogStories(context));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("derives stats from milestone sums when runtime totals are absent", async () => {
        clearRuntimeProject(); // fallback project has null totals
        const { result } = await renderLoaded();
        // total_milestones falls back to the number of loaded sprints.
        expect(result.current.stats?.total_milestones).toBeGreaterThanOrEqual(1);
    });
});

/* --------------------------------------------------------------------------- *
 * Permissions / activation
 * --------------------------------------------------------------------------- */

describe("permissions + activation", () => {
    it("reads my_permissions for hasPermission", async () => {
        const { result } = await renderLoaded();
        expect(result.current.hasPermission("modify_us")).toBe(true);
        expect(result.current.hasPermission("delete_project")).toBe(false);
    });

    it("reflects is_backlog_activated === false", async () => {
        setRuntimeProject(runtimeProject({ is_backlog_activated: false }));
        const { result } = await renderLoaded();
        expect(result.current.isBacklogActivated).toBe(false);
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

    it("rolls the optimistic reshuffle back when the bulk call rejects", async () => {
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
        expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("reloads from the server after the batch when the WebSocket is disconnected", async () => {
        const { result } = await renderLoaded();
        isConnected.mockReturnValue(false);
        listMilestones.mockClear();

        act(() => {
            result.current.moveUs([us(11)], 0, null, null, us(10));
        });
        await waitFor(() => expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1));
        // Fallback reload = loadSprints + loadClosedSprints.
        await waitFor(() => expect(listMilestones).toHaveBeenCalled());
    });
});

describe("moveToSprint / moveUsToTop", () => {
    it("moveToSprint issues one milestone bulk call and reloads", async () => {
        const { result } = await renderLoaded();
        listMilestones.mockClear();
        act(() => {
            result.current.moveToSprint([us(10)], 5);
        });
        await waitFor(() => expect(bulkUpdateMilestone).toHaveBeenCalledTimes(1));
        expect(bulkUpdateMilestone).toHaveBeenCalledWith(7, 5, [{ us_id: 10, order: 10 }]);
        await waitFor(() => expect(listMilestones).toHaveBeenCalled());
    });

    it("moveToSprint rolls back on reject", async () => {
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

/* --------------------------------------------------------------------------- *
 * Inline editors + delete
 * --------------------------------------------------------------------------- */

describe("inline editors + delete", () => {
    it("updateUserStoryStatus PATCHes only the dirty status field", async () => {
        const { result } = await renderLoaded();
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
    });

    it("updateUserStoryStatus reloads on reject", async () => {
        const { result } = await renderLoaded();
        save.mockRejectedValueOnce(new Error("save failed"));
        listUserStories.mockClear();
        act(() => {
            result.current.updateUserStoryStatus(us(10), 2);
        });
        await waitFor(() => expect(listUserStories).toHaveBeenCalled());
        expect(consoleErrorSpy).toHaveBeenCalled();
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
        // runtime role id 3 is computable.
        expect(save).toHaveBeenCalledWith(
            "userstories",
            expect.objectContaining({ id: 10 }),
            { points: { "3": 42 } },
        );
    });

    it("deleteUserStory removes optimistically then reloads after confirm", async () => {
        const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
        const { result } = await renderLoaded();
        listMilestones.mockClear();
        act(() => {
            result.current.deleteUserStory(us(10));
        });
        await waitFor(() => expect(remove).toHaveBeenCalledWith("userstories", 10));
        await waitFor(() =>
            expect(result.current.userstories.map((u) => u.id)).toEqual([11]),
        );
        await waitFor(() => expect(listMilestones).toHaveBeenCalled());
        confirmSpy.mockRestore();
    });

    it("deleteUserStory is a no-op when the confirm dialog is dismissed", async () => {
        const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
        const { result } = await renderLoaded();
        act(() => {
            result.current.deleteUserStory(us(10));
        });
        expect(remove).not.toHaveBeenCalled();
        expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11]);
        confirmSpy.mockRestore();
    });

    it("deleteUserStory rolls back on reject", async () => {
        const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
        remove.mockRejectedValueOnce(new Error("delete failed"));
        const { result } = await renderLoaded();
        act(() => {
            result.current.deleteUserStory(us(10));
        });
        await waitFor(() => expect(remove).toHaveBeenCalled());
        await waitFor(() =>
            expect(result.current.userstories.map((u) => u.id)).toEqual([10, 11]),
        );
        confirmSpy.mockRestore();
    });
});

/* --------------------------------------------------------------------------- *
 * US-lightbox bridge (window CustomEvents)
 * --------------------------------------------------------------------------- */

describe("US-lightbox bridge", () => {
    it("addNewUs dispatches tg-react:us:new with the type + projectId", async () => {
        const { result } = await renderLoaded();
        const dispatchSpy = jest.spyOn(window, "dispatchEvent");
        act(() => {
            result.current.addNewUs("bulk");
        });
        const event = dispatchSpy.mock.calls
            .map((c) => c[0])
            .find((e): e is CustomEvent => e instanceof CustomEvent && e.type === "tg-react:us:new");
        expect(event).toBeDefined();
        expect((event?.detail as { type: string }).type).toBe("bulk");
        expect((event?.detail as { projectId: number }).projectId).toBe(7);
        dispatchSpy.mockRestore();
    });

    it("editUserStory dispatches tg-react:us:edit with the story", async () => {
        const { result } = await renderLoaded();
        const dispatchSpy = jest.spyOn(window, "dispatchEvent");
        act(() => {
            result.current.editUserStory(us(11));
        });
        const event = dispatchSpy.mock.calls
            .map((c) => c[0])
            .find(
                (e): e is CustomEvent => e instanceof CustomEvent && e.type === "tg-react:us:edit",
            );
        expect(event).toBeDefined();
        expect((event?.detail as { us: UserStory }).us.id).toBe(11);
        dispatchSpy.mockRestore();
    });

    it("reloads the backlog when the shell reports a saved US", async () => {
        await renderLoaded();
        listUserStories.mockClear();
        act(() => {
            window.dispatchEvent(new CustomEvent("tg-react:us:saved"));
        });
        await waitFor(() => expect(listUserStories).toHaveBeenCalled());
    });

    it("reloads the backlog when the shell reports a deleted US", async () => {
        await renderLoaded();
        listUserStories.mockClear();
        act(() => {
            window.dispatchEvent(new CustomEvent("tg-react:us:deleted"));
        });
        await waitFor(() => expect(listUserStories).toHaveBeenCalled());
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

    it("createSprintFromForecasting opens the create lightbox", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.createSprintFromForecasting();
        });
        expect(result.current.sprintLightbox.open).toBe(true);
        expect(result.current.sprintLightbox.mode).toBe("create");
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

    it("onSprintSaved closes the lightbox and reloads sprints", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.openCreateSprint();
        });
        listMilestones.mockClear();
        act(() => {
            result.current.onSprintSaved();
        });
        expect(result.current.sprintLightbox.open).toBe(false);
        await waitFor(() => expect(listMilestones).toHaveBeenCalled());
    });

    it("onSprintDeleted reloads everything and turns velocity off", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleVelocityForecasting(); // velocity on
        });
        expect(result.current.displayVelocity).toBe(true);
        listUserStories.mockClear();
        act(() => {
            result.current.onSprintDeleted();
        });
        expect(result.current.sprintLightbox.open).toBe(false);
        await waitFor(() => expect(listUserStories).toHaveBeenCalled());
        await waitFor(() => expect(result.current.displayVelocity).toBe(false));
    });
});

/* --------------------------------------------------------------------------- *
 * Toggles + search
 * --------------------------------------------------------------------------- */

describe("toggles + search", () => {
    it("toggleShowTags flips + persists", async () => {
        const { result } = await renderLoaded();
        expect(result.current.showTags).toBe(true);
        act(() => {
            result.current.toggleShowTags();
        });
        expect(result.current.showTags).toBe(false);
        expect(window.localStorage.getItem("taiga-react:backlog:7:showTags")).toBe("false");
    });

    it("toggleActiveFilters flips", async () => {
        const { result } = await renderLoaded();
        expect(result.current.activeFilters).toBe(false);
        act(() => {
            result.current.toggleActiveFilters();
        });
        expect(result.current.activeFilters).toBe(true);
    });

    it("toggleVelocityForecasting flips + persists", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleVelocityForecasting();
        });
        expect(result.current.displayVelocity).toBe(true);
        expect(window.localStorage.getItem("taiga-react:backlog:7:displayVelocity")).toBe("true");
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
        listUserStories.mockClear();
        jest.useFakeTimers();
        act(() => {
            jest.advanceTimersByTime(600);
        });
        jest.useRealTimers();
        await waitFor(() =>
            expect(listUserStories).toHaveBeenCalledWith(
                expect.objectContaining({ q: "bug", milestone: "null" }),
            ),
        );
    });

    it("loadUserstories can be invoked directly", async () => {
        const { result } = await renderLoaded();
        listUserStories.mockClear();
        act(() => {
            result.current.loadUserstories();
        });
        await waitFor(() => expect(listUserStories).toHaveBeenCalled());
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
        listUserStories.mockClear();
        listMilestones.mockClear();
        jest.useFakeTimers();
        act(() => {
            capturedHandlers.onUserStories?.(undefined);
            jest.advanceTimersByTime(1100);
        });
        jest.useRealTimers();
        await waitFor(() => expect(listUserStories).toHaveBeenCalled());
        await waitFor(() => expect(listMilestones).toHaveBeenCalled());
    });

    it("reloads sprints + closed sprints on the milestones key", async () => {
        await renderLoaded();
        listMilestones.mockClear();
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
    });

    it("tears the subscription down on unmount", async () => {
        const view = await renderLoaded();
        view.unmount();
        expect(capturedCleanup).toHaveBeenCalled();
        expect(stop).toHaveBeenCalled();
    });
});
