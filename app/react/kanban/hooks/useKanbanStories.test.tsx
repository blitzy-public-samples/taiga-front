/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit / contract tests for {@link useKanbanStories}.
 *
 * These tests exercise the hook against MOCKED `../../shared/api` and
 * `../../shared/ws/events` modules while using the REAL `../../shared/state`
 * immer producers (they are pure), so the state transitions are genuinely
 * verified. They assert the contract-parity items called out in the file's
 * agent prompt validation checklist:
 *   - initial load builds the board projections,
 *   - EXACTLY ONE `bulkUpdateKanbanOrder` per drop, with `swimlaneId === -1`
 *     mapped to `null`, applied optimistically and ROLLED BACK on API failure,
 *   - the WS subscription uses ONLY `{ onUserStories, onProjects }` (no
 *     milestones) and tears down cleanly,
 *   - the preserved zoom asymmetry (reload only when crossing into index 3),
 *   - fold / swimlane-fold localStorage persistence + hydration,
 *   - archived statuses land in BOTH `archivedStatus` and `statusHide`, and
 *   - graceful degradation when no runtime project is present on `window`.
 */

import { act, renderHook, waitFor } from "@testing-library/react";

import { useKanbanStories } from "./useKanbanStories";
import { createApiClient } from "../../shared/api";
import { createEventsClient, subscribeToProject } from "../../shared/ws/events";
import type { MountContext, Status, UserStory } from "../../shared/types";

jest.mock("../../shared/api");
jest.mock("../../shared/ws/events");

/* -------------------------------------------------------------------------- */
/* Typed mock handles                                                          */
/* -------------------------------------------------------------------------- */
const mockedCreateApiClient = createApiClient as jest.Mock;
const mockedCreateEventsClient = createEventsClient as jest.Mock;
const mockedSubscribeToProject = subscribeToProject as jest.Mock;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */
const PROJECT_ID = 42;

const CONTEXT: MountContext = {
    projectSlug: "proj",
    token: "tok",
    sessionId: "sess",
    apiUrl: "http://api.test/api/v1",
    eventsUrl: "ws://events.test",
    language: "en",
};

const STATUSES: Status[] = [
    { id: 1, name: "New", order: 1, is_archived: false, wip_limit: null },
    { id: 2, name: "Done", order: 2, is_archived: false, wip_limit: null },
    { id: 3, name: "Archived", order: 3, is_archived: true, wip_limit: null },
];

function makeStory(id: number, status: number, kanban_order: number): UserStory {
    return { id, ref: id, subject: `US ${id}`, status, swimlane: null, kanban_order };
}

/** Non-archived stories the main list load returns. */
const STORIES: UserStory[] = [
    makeStory(101, 1, 1),
    makeStory(102, 1, 2),
    makeStory(103, 2, 1),
];

/**
 * Return a FRESH deep-ish copy of a story list. The real `listUserStories`
 * always returns a newly-parsed array; the shared `set` producer sorts
 * `userstoriesRaw` in place, and immer deep-FREEZES the state it produces. If a
 * test handed the same array reference to two loads, the second `set` would sort
 * a now-frozen array and throw. Copying per call reproduces production reality.
 */
const fresh = (list: UserStory[] = STORIES): UserStory[] => list.map((s) => ({ ...s }));

/** Filters payload returned by getUserStoriesFilters. */
function filtersPayload(): unknown {
    return {
        statuses: [
            { id: 1, name: "New", order: 1 },
            { id: 2, name: "Done", order: 2 },
            { id: 3, name: "Archived", order: 3, is_archived: true },
        ],
        tags: [],
        assigned_to: [],
        owners: [],
        epics: [],
        roles: [],
    };
}

/** Install a runtime project on `window` (the cross-framework bridge). */
function setRuntimeProject(overrides: Record<string, unknown> = {}): void {
    (window as unknown as { taigaConfig?: unknown }).taigaConfig = {
        project: {
            id: PROJECT_ID,
            slug: "proj",
            name: "Proj",
            my_permissions: ["modify_us", "add_us"],
            is_kanban_activated: true,
            is_backlog_activated: false,
            i_am_admin: true,
            default_swimlane: null,
            us_statuses: STATUSES,
            swimlanes: [],
            members: [{ id: 7, full_name_display: "Alice" }],
            ...overrides,
        },
    };
}

function clearRuntimeProject(): void {
    const w = window as unknown as {
        taigaConfig?: unknown;
        _project?: unknown;
        taigaCurrentProject?: unknown;
    };
    delete w.taigaConfig;
    delete w._project;
    delete w.taigaCurrentProject;
}

interface MockApiClient {
    resolveProject: jest.Mock;
    getUserStoriesFilters: jest.Mock;
    listUserStories: jest.Mock;
    bulkUpdateKanbanOrder: jest.Mock;
    editStatus: jest.Mock;
    bulkCreateUserStories: jest.Mock;
    create: jest.Mock;
    remove: jest.Mock;
}

interface MockEventsClient {
    setupConnection: jest.Mock;
    stop: jest.Mock;
    subscribe: jest.Mock;
    unsubscribe: jest.Mock;
    isConnected: jest.Mock;
}

let apiClient: MockApiClient;
let eventsClient: MockEventsClient;
let wsCleanup: jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    clearRuntimeProject();
    setRuntimeProject();

    apiClient = {
        resolveProject: jest.fn().mockResolvedValue(PROJECT_ID),
        getUserStoriesFilters: jest.fn().mockImplementation(() => Promise.resolve(filtersPayload())),
        listUserStories: jest.fn().mockImplementation(() => Promise.resolve(fresh())),
        bulkUpdateKanbanOrder: jest.fn().mockResolvedValue([]),
        editStatus: jest.fn().mockImplementation(() => Promise.resolve({ ...STATUSES[0] })),
        bulkCreateUserStories: jest.fn().mockImplementation(() => Promise.resolve([makeStory(201, 1, 3)])),
        create: jest.fn().mockImplementation(() => Promise.resolve(makeStory(202, 1, 4))),
        remove: jest.fn().mockResolvedValue(undefined),
    };
    mockedCreateApiClient.mockReturnValue(apiClient);

    wsCleanup = jest.fn();
    eventsClient = {
        setupConnection: jest.fn(),
        stop: jest.fn(),
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
    };
    mockedCreateEventsClient.mockReturnValue(eventsClient);
    mockedSubscribeToProject.mockReturnValue(wsCleanup);

    // Deterministic randomInt(700, 1000) -> 700.
    jest.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
    jest.restoreAllMocks();
});

/** Render the hook and wait until the initial load has settled. */
async function renderLoaded() {
    const rendered = renderHook(() => useKanbanStories(CONTEXT));
    await waitFor(() => expect(rendered.result.current.initialLoad).toBe(true));
    return rendered;
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("useKanbanStories — initial load", () => {
    test("resolves project, loads statuses, swimlanes, stories and members", async () => {
        const { result } = await renderLoaded();

        expect(apiClient.resolveProject).toHaveBeenCalledWith("proj");
        expect(result.current.projectId).toBe(PROJECT_ID);
        expect(result.current.isAdmin).toBe(true);

        // Statuses parsed + sorted by order.
        expect(result.current.usStatusList.map((s) => s.id)).toEqual([1, 2, 3]);

        // Story projections built by the real `set` producer.
        expect(result.current.usByStatus["1"]).toEqual(expect.arrayContaining([101, 102]));
        expect(result.current.usMap[103]).toBeDefined();

        // Members hydrated into usersById.
        expect(result.current.usersById[7]).toBeDefined();
        expect(result.current.usersById[7].full_name_display).toBe("Alice");

        // Non-swimlane mode -> empty swimlanesList.
        expect(result.current.swimlanesList).toEqual([]);
    });

    test("archived status lands in BOTH archivedStatus and statusHide", async () => {
        // Include an archived story so the selector has something to resolve.
        apiClient.listUserStories.mockImplementation(() =>
            Promise.resolve(fresh([...STORIES, makeStory(104, 3, 1)])),
        );
        const { result } = await renderLoaded();

        // Column 3 is archived -> hidden (removed from usByStatus).
        expect(result.current.usByStatus["3"]).toBeUndefined();
        // The story in the archived+hidden status resolves true.
        expect(result.current.isUsInArchivedHiddenStatus(104)).toBe(true);
        // A story in a visible status resolves false.
        expect(result.current.isUsInArchivedHiddenStatus(101)).toBe(false);
        // Archived column defaults to folded.
        expect(result.current.folds[3]).toBe(true);
    });

    test("graceful degradation when no runtime project on window", async () => {
        clearRuntimeProject();
        const { result } = await renderLoaded();

        expect(result.current.project).not.toBeNull();
        expect(result.current.project?.my_permissions).toEqual([]);
        expect(result.current.project?.is_kanban_activated).toBe(true);
        expect(result.current.isAdmin).toBe(false);
    });

    test("module-disabled project still completes initialLoad", async () => {
        setRuntimeProject({ is_kanban_activated: false });
        const { result } = await renderLoaded();

        expect(result.current.initialLoad).toBe(true);
        // The disabled gate short-circuits BEFORE the stories load.
        expect(apiClient.listUserStories).not.toHaveBeenCalled();
    });

    test("hydrates folds/swimlane folds from localStorage on init", async () => {
        window.localStorage.setItem(
            `taiga.react.kanban.folds.${PROJECT_ID}`,
            JSON.stringify({ 2: true }),
        );
        window.localStorage.setItem(
            `taiga.react.kanban.swimlanes.${PROJECT_ID}`,
            JSON.stringify({ 9: true }),
        );
        const { result } = await renderLoaded();

        expect(result.current.folds[2]).toBe(true);
        expect(result.current.foldedSwimlane[9]).toBe(true);
    });

    test("notFoundUserstories is true when a search yields nothing", async () => {
        apiClient.listUserStories.mockImplementation(() => Promise.resolve([]));
        const { result } = await renderLoaded();

        act(() => {
            result.current.changeQ("nomatch");
        });
        await waitFor(() => expect(result.current.filterQ).toBe("nomatch"));
        await waitFor(() => expect(result.current.notFoundUserstories).toBe(true));
    });

    test("sets error but still completes initialLoad when a load rejects", async () => {
        apiClient.getUserStoriesFilters.mockRejectedValue(new Error("boom"));
        const { result } = await renderLoaded();

        expect(result.current.initialLoad).toBe(true);
        expect(result.current.error).toBeInstanceOf(Error);
    });
});

describe("useKanbanStories — drag move + persist + rollback", () => {
    test("handleDragEnd issues exactly ONE bulkUpdateKanbanOrder and maps -1 -> null", async () => {
        const { result } = await renderLoaded();

        await act(async () => {
            result.current.handleDragEnd({
                usList: [101],
                statusId: 2,
                swimlaneId: -1,
                index: 0,
                previousCard: null,
                nextCard: 103,
            });
        });

        await waitFor(() => expect(apiClient.bulkUpdateKanbanOrder).toHaveBeenCalledTimes(1));
        const callArgs = apiClient.bulkUpdateKanbanOrder.mock.calls[0];
        expect(callArgs[0]).toBe(PROJECT_ID); // projectId
        expect(callArgs[1]).toBe(2); // statusId
        expect(callArgs[2]).toBeNull(); // swimlaneId (-1 -> null)

        // Optimistically moved into status 2.
        expect(result.current.usByStatus["2"]).toEqual(expect.arrayContaining([101]));
    });

    test("rolls back the board state when the bulk call rejects", async () => {
        apiClient.bulkUpdateKanbanOrder.mockRejectedValue(new Error("save failed"));
        const { result } = await renderLoaded();

        expect(result.current.usByStatus["1"]).toEqual(expect.arrayContaining([101]));

        await act(async () => {
            result.current.handleDragEnd({
                usList: [101],
                statusId: 2,
                swimlaneId: -1,
                index: 0,
                previousCard: null,
                nextCard: 103,
            });
        });

        await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
        // Snapshot restored: 101 back in status 1, absent from status 2.
        expect(result.current.usByStatus["1"]).toEqual(expect.arrayContaining([101]));
        expect(result.current.usByStatus["2"] ?? []).not.toContain(101);
        expect(result.current.movedUs).toEqual([]);
    });

    test("moveToTopDropdown reuses the single-bulk optimistic path", async () => {
        const { result } = await renderLoaded();

        // 102 is not first in column 1; moving it to top persists once.
        await act(async () => {
            result.current.moveToTopDropdown(102);
        });

        await waitFor(() => expect(apiClient.bulkUpdateKanbanOrder).toHaveBeenCalledTimes(1));
        expect(result.current.usByStatus["1"][0]).toBe(102);
    });

    test("moveToTopDropdown is a no-op for an already-first card", async () => {
        const { result } = await renderLoaded();
        const firstId = result.current.usByStatus["1"][0];

        await act(async () => {
            result.current.moveToTopDropdown(firstId);
        });

        expect(apiClient.bulkUpdateKanbanOrder).not.toHaveBeenCalled();
    });
});

describe("useKanbanStories — websocket wiring", () => {
    test("subscribes to only onUserStories + onProjects and tears down cleanly", async () => {
        const { unmount } = await renderLoaded();

        await waitFor(() => expect(mockedSubscribeToProject).toHaveBeenCalled());
        expect(mockedCreateEventsClient).toHaveBeenCalled();
        expect(eventsClient.setupConnection).toHaveBeenCalled();

        const [, projectIdArg, handlers] = mockedSubscribeToProject.mock.calls[0];
        expect(projectIdArg).toBe(PROJECT_ID);
        expect(typeof handlers.onUserStories).toBe("function");
        expect(typeof handlers.onProjects).toBe("function");
        expect(handlers.onMilestones).toBeUndefined();

        unmount();
        expect(wsCleanup).toHaveBeenCalled();
        expect(eventsClient.stop).toHaveBeenCalled();
    });

    test("debounced onUserStories refetches and diffs into state", async () => {
        const { result } = await renderLoaded();
        await waitFor(() => expect(mockedSubscribeToProject).toHaveBeenCalled());
        const handlers = mockedSubscribeToProject.mock.calls[0][2];

        apiClient.listUserStories.mockClear();
        apiClient.listUserStories.mockImplementation(() =>
            // a brand-new story (105) -> add(); existing ones -> replaceModel()
            Promise.resolve(fresh([...STORIES, makeStory(105, 2, 9)])),
        );

        act(() => {
            handlers.onUserStories({ pk: 105 });
        });

        // Trailing debounce fires ~700ms after the last call (Math.random -> 0).
        await waitFor(() => expect(apiClient.listUserStories).toHaveBeenCalled(), {
            timeout: 2000,
        });
        await waitFor(() => expect(result.current.usMap[105]).toBeDefined(), { timeout: 2000 });
    });

    test("onProjects with a relevant match refreshes statuses/swimlanes", async () => {
        const { result } = await renderLoaded();
        await waitFor(() => expect(mockedSubscribeToProject).toHaveBeenCalled());
        const handlers = mockedSubscribeToProject.mock.calls[0][2];

        apiClient.getUserStoriesFilters.mockClear();

        act(() => {
            handlers.onProjects({ matches: "projects.userstorystatus" });
        });

        await waitFor(() => expect(apiClient.getUserStoriesFilters).toHaveBeenCalled(), {
            timeout: 2000,
        });
        expect(result.current.usStatusList.length).toBeGreaterThan(0);
    });

    test("onProjects with an irrelevant match does nothing", async () => {
        await renderLoaded();
        await waitFor(() => expect(mockedSubscribeToProject).toHaveBeenCalled());
        const handlers = mockedSubscribeToProject.mock.calls[0][2];

        apiClient.getUserStoriesFilters.mockClear();
        act(() => {
            handlers.onProjects({ matches: "projects.name" });
        });
        // Give the (would-be) debounce a chance to run; nothing should fire.
        await new Promise((r) => setTimeout(r, 800));
        expect(apiClient.getUserStoriesFilters).not.toHaveBeenCalled();
    });
});

describe("useKanbanStories — zoom", () => {
    test("persists kanban_zoom and reloads ONLY when crossing into index 3", async () => {
        const { result } = await renderLoaded();
        const loadsAfterInit = apiClient.listUserStories.mock.calls.length;

        // idx 2 from default 1: NO reload (asymmetry preserved).
        await act(async () => {
            result.current.setZoom(2);
        });
        expect(window.localStorage.getItem("kanban_zoom")).toBe("2");
        expect(apiClient.listUserStories).toHaveBeenCalledTimes(loadsAfterInit);

        // idx 3 from 2 (prev <= 2): RELOAD.
        await act(async () => {
            result.current.setZoom(3);
        });
        expect(window.localStorage.getItem("kanban_zoom")).toBe("3");
        await waitFor(() =>
            expect(apiClient.listUserStories).toHaveBeenCalledTimes(loadsAfterInit + 1),
        );

        // Cumulative zoom view exposes the level-3 features.
        expect(result.current.zoom).toEqual(expect.arrayContaining(["related_tasks", "attachments"]));
    });

    test("setZoom is a no-op when the index is unchanged", async () => {
        const { result } = await renderLoaded();
        const before = apiClient.listUserStories.mock.calls.length;
        await act(async () => {
            result.current.setZoom(result.current.zoomLevel);
        });
        expect(apiClient.listUserStories).toHaveBeenCalledTimes(before);
    });
});

describe("useKanbanStories — folds and localStorage", () => {
    test("foldStatus persists the fold map and tracks unfold", async () => {
        const { result } = await renderLoaded();

        act(() => {
            result.current.foldStatus(STATUSES[0]); // fold column 1 -> true
        });
        expect(result.current.folds[1]).toBe(true);
        expect(
            JSON.parse(window.localStorage.getItem(`taiga.react.kanban.folds.${PROJECT_ID}`) ?? "{}"),
        ).toMatchObject({ 1: true });

        act(() => {
            result.current.foldStatus(STATUSES[0]); // unfold column 1 -> false
        });
        expect(result.current.folds[1]).toBe(false);
        expect(result.current.unfold).toBe(1);
    });

    test("toggleSwimlane persists the swimlane-fold map", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleSwimlane(5);
        });
        expect(result.current.foldedSwimlane[5]).toBe(true);
        expect(
            JSON.parse(
                window.localStorage.getItem(`taiga.react.kanban.swimlanes.${PROJECT_ID}`) ?? "{}",
            ),
        ).toMatchObject({ 5: true });
    });

    test("toggleFold flips the card-fold flag via the shared producer", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleFold(101);
        });
        expect(result.current.foldStatusChanged[101]).toBe(true);
    });

    test("setColumnMode persists and drives isMaximized/isMinimized", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.setColumnMode(1, "max");
        });
        expect(result.current.isMaximized(1)).toBe(true);
        expect(result.current.isMinimized(1)).toBe(false);

        act(() => {
            result.current.setColumnMode(1, "min");
        });
        expect(result.current.isMinimized(1)).toBe(true);

        act(() => {
            result.current.setColumnMode(1, undefined);
        });
        expect(result.current.isMaximized(1)).toBe(false);
        expect(result.current.isMinimized(1)).toBe(false);
    });
});

describe("useKanbanStories — userstory CRUD + lightbox", () => {
    test("addNewUs -> submitNewUs creates a story and closes the lightbox", async () => {
        const { result } = await renderLoaded();

        act(() => {
            result.current.addNewUs("standard", 1);
        });
        expect(result.current.activeLightbox).toEqual({ type: "create", statusId: 1 });

        await act(async () => {
            await result.current.submitNewUs("brand new");
        });

        expect(apiClient.create).toHaveBeenCalledWith(
            "userstories",
            expect.objectContaining({ project: PROJECT_ID, status: 1, subject: "brand new" }),
        );
        expect(result.current.activeLightbox).toBeNull();
        expect(result.current.usMap[202]).toBeDefined();
    });

    test("addNewUs bulk -> submitBulkUs bulk-creates and closes", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.addNewUs("bulk", 1);
        });
        expect(result.current.activeLightbox).toEqual({ type: "bulk", statusId: 1 });

        await act(async () => {
            await result.current.submitBulkUs("line a\nline b");
        });
        expect(apiClient.bulkCreateUserStories).toHaveBeenCalledWith(PROJECT_ID, 1, "line a\nline b", null);
        expect(result.current.usMap[201]).toBeDefined();
        expect(result.current.activeLightbox).toBeNull();
    });

    test("editUs and changeUsAssignedUsers open the right lightbox", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.editUs(103);
        });
        expect(result.current.activeLightbox).toEqual({ type: "edit", usId: 103 });
        act(() => {
            result.current.changeUsAssignedUsers(103);
        });
        expect(result.current.activeLightbox).toEqual({ type: "assign", usId: 103 });
        act(() => {
            result.current.closeLightbox();
        });
        expect(result.current.activeLightbox).toBeNull();
    });

    test("deleteUs removes optimistically and rolls back on failure", async () => {
        apiClient.remove.mockRejectedValue(new Error("nope"));
        const { result } = await renderLoaded();
        expect(result.current.usMap[101]).toBeDefined();

        await act(async () => {
            await result.current.deleteUs(101);
        });

        await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
        // Rolled back -> the story is present again.
        expect(result.current.usMap[101]).toBeDefined();
    });

    test("deleteUs removes on success", async () => {
        const { result } = await renderLoaded();
        await act(async () => {
            await result.current.deleteUs(101);
        });
        expect(result.current.usMap[101]).toBeUndefined();
    });
});

describe("useKanbanStories — selection, wip, filters, selectors", () => {
    test("toggleSelectedUs toggles selection", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.toggleSelectedUs(101);
        });
        expect(result.current.selectedUss[101]).toBe(true);
        act(() => {
            result.current.toggleSelectedUs(101);
        });
        expect(result.current.selectedUss[101]).toBeUndefined();
    });

    test("editWipLimit updates optimistically and rolls back on failure", async () => {
        apiClient.editStatus.mockRejectedValue(new Error("wip fail"));
        const { result } = await renderLoaded();

        await act(async () => {
            await result.current.editWipLimit(1, 5);
        });

        await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
        // Rolled back to the original (null) wip limit.
        const s1 = result.current.usStatusList.find((s) => s.id === 1);
        expect(s1?.wip_limit ?? null).toBeNull();
    });

    test("editWipLimit persists on success", async () => {
        const { result } = await renderLoaded();
        await act(async () => {
            await result.current.editWipLimit(1, 7);
        });
        const s1 = result.current.usStatusList.find((s) => s.id === 1);
        expect(s1?.wip_limit).toBe(7);
        expect(apiClient.editStatus).toHaveBeenCalledWith(1, 7);
    });

    test("showPlaceHolder reflects emptiness of a column", async () => {
        const { result } = await renderLoaded();
        // status 2 has a card (103) -> not a placeholder.
        expect(result.current.showPlaceHolder(2)).toBe(false);
        // an unknown status -> empty -> placeholder.
        expect(result.current.showPlaceHolder(999)).toBe(true);
    });

    test("custom filters operate on local state and never throw", async () => {
        const { result } = await renderLoaded();
        act(() => {
            result.current.addFilter({ category: "tags", id: "urgent" });
        });
        act(() => {
            result.current.saveCustomFilter("my filter");
        });
        expect(result.current.customFilters.length).toBe(1);
        act(() => {
            result.current.selectCustomFilter(result.current.customFilters[0]);
        });
        act(() => {
            result.current.removeFilter({ category: "tags", id: "urgent" });
        });
        act(() => {
            result.current.removeCustomFilter(result.current.customFilters[0]);
        });
        expect(result.current.customFilters.length).toBe(0);
    });

    test("showArchivedStatus reveals a hidden archived column and fetches its stories", async () => {
        // Realistic: archived stories are NOT in the main load (which sends
        // status__is_archived: false), so status 3 starts hidden and empty.
        const { result } = await renderLoaded();
        expect(result.current.usByStatus["3"]).toBeUndefined();

        // Revealing the archived column fetches its (previously unseen) stories.
        apiClient.listUserStories.mockImplementation(() =>
            Promise.resolve(fresh([makeStory(104, 3, 1)])),
        );
        await act(async () => {
            await result.current.showArchivedStatus(3);
        });
        await waitFor(() => expect(result.current.usByStatus["3"]).toBeDefined());
        expect(result.current.usMap[104]).toBeDefined();
    });
});

describe("useKanbanStories — return surface completeness", () => {
    test("exposes every member KanbanBoard destructures", async () => {
        const { result } = await renderLoaded();
        const kb = result.current;

        // Load state
        for (const key of [
            "initialLoad",
            "project",
            "projectId",
            "isAdmin",
            "renderInProgress",
            "notFoundUserstories",
        ]) {
            expect(kb).toHaveProperty(key);
        }
        // "error" may be null; assert the property exists explicitly.
        expect("error" in kb).toBe(true);

        // Board data
        for (const key of [
            "usStatusList",
            "swimlanesList",
            "swimlanesStatuses",
            "usByStatus",
            "usByStatusSwimlanes",
            "usMap",
            "usersById",
        ]) {
            expect(kb).toHaveProperty(key);
        }

        // Function members must be callable.
        const fnMembers: Array<keyof typeof kb> = [
            "setZoom",
            "changeQ",
            "addFilter",
            "saveCustomFilter",
            "selectCustomFilter",
            "removeCustomFilter",
            "removeFilter",
            "handleDragEnd",
            "toggleSwimlane",
            "foldStatus",
            "toggleFold",
            "addNewUs",
            "editUs",
            "deleteUs",
            "changeUsAssignedUsers",
            "moveToTopDropdown",
            "toggleSelectedUs",
            "editWipLimit",
            "showArchivedStatus",
            "setColumnMode",
            "isMaximized",
            "isMinimized",
            "isUsInArchivedHiddenStatus",
            "showPlaceHolder",
            "closeLightbox",
            "submitNewUs",
            "submitBulkUs",
        ];
        for (const key of fnMembers) {
            expect(typeof kb[key]).toBe("function");
        }
    });
});
