/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DropNeighbors, NormalizedDragEnd, ResolvedDrop } from "../../shared/dnd/DndProvider";
import type { KanbanState } from "../useKanbanState";

interface CapturedProps {
    state: KanbanState;
    canAddUs: boolean;
    dragging?: boolean;
    folds: Record<number, boolean>;
    foldedSwimlane: Record<number, boolean>;
    resolveDrop: (e: NormalizedDragEnd) => ResolvedDrop | null;
    persist: (r: ResolvedDrop, n: DropNeighbors) => void | Promise<void>;
    onAddUs?: (type: "standard" | "bulk", statusId: number) => void;
    onFoldStatus?: (status: { id: number }) => void;
    onToggleSwimlane?: (swimlaneId: number) => void;
    onToggleFold?: (usId: number) => void;
    onClickDelete?: (usId: number) => void;
    isArchivedHidden?: (usId: number) => boolean;
    showPlaceholder?: (statusId: number, swimlaneId: number | null) => boolean;
}
const mockBoardHolder: { props: CapturedProps | null } = { props: null };
jest.mock("../KanbanBoard", () => ({
    KanbanBoard: (props: CapturedProps) => {
        mockBoardHolder.props = props;
        return <div data-testid="board-stub" />;
    },
}));

type SubCb = (data: unknown) => void;
const mockEvents: {
    subs: Record<string, SubCb>;
    connected: boolean;
    disconnected: boolean;
    unsubscribed: string[];
} = { subs: {}, connected: false, disconnected: false, unsubscribed: [] };
jest.mock("../../shared/events/websocket", () => ({
    createEventsClient: () => ({
        connect: () => {
            mockEvents.connected = true;
        },
        subscribe: (key: string, cb: SubCb) => {
            mockEvents.subs[key] = cb;
        },
        unsubscribe: (key: string) => {
            mockEvents.unsubscribed.push(key);
        },
        disconnect: () => {
            mockEvents.disconnected = true;
        },
    }),
}));

// Imported AFTER the mock is declared (jest hoists jest.mock above imports).
import {
    KanbanApp,
    parseContainerKey,
    resolveKanbanDrop,
    zoomKeysFor,
} from "../KanbanApp";

const statuses = [
    { id: 1, name: "New", color: "#f00", order: 1, is_archived: false, wip_limit: null },
    { id: 2, name: "Done", color: "#0f0", order: 2, is_archived: false, wip_limit: null },
];
function makeProject(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 7, name: "Proj", slug: "proj", is_kanban_activated: true,
        my_permissions: ["view_us", "add_us", "modify_us"],
        us_statuses: statuses, members: [], points: [], i_am_admin: true, ...over,
    };
}
const userstories = [
    { id: 101, status: 1, swimlane: null, kanban_order: 1, subject: "First", ref: 101 },
    { id: 102, status: 1, swimlane: null, kanban_order: 2, subject: "Second", ref: 102 },
];

function mockResponse(status: number, data: unknown): Response {
    return {
        ok: status >= 200 && status < 300, status, statusText: "",
        headers: new Headers(), text: async () => JSON.stringify(data),
    } as unknown as Response;
}
let fetchMock: jest.Mock;
function installFetch(project: Record<string, unknown>): void {
    fetchMock = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("bulk_create")) return Promise.resolve(mockResponse(200, []));
        if (url.includes("bulk_update_kanban_order")) return Promise.resolve(mockResponse(200, []));
        if (url.includes("/projects/")) return Promise.resolve(mockResponse(200, project));
        if (url.includes("/swimlanes")) return Promise.resolve(mockResponse(200, []));
        if (url.includes("/userstories")) return Promise.resolve(mockResponse(200, userstories));
        return Promise.resolve(mockResponse(200, []));
    });
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
}
function findCall(sub: string): unknown[] | undefined {
    return fetchMock.mock.calls.find((c) => String(c[0]).includes(sub));
}
function bodyOf(call: unknown[]): Record<string, unknown> {
    return JSON.parse((call[1] as RequestInit).body as string);
}

beforeEach(() => {
    mockBoardHolder.props = null;
    mockEvents.subs = {};
    mockEvents.connected = false;
    mockEvents.disconnected = false;
    mockEvents.unsubscribed = [];
    (window as unknown as { taigaConfig: unknown }).taigaConfig = { api: "http://localhost:8000/api/v1/" };
    (window as unknown as { taiga: unknown }).taiga = { sessionId: "sess-1" };
    installFetch(makeProject());
});
afterEach(() => {
    delete (global as unknown as { fetch?: unknown }).fetch;
});

async function renderLoaded(): Promise<void> {
    render(<KanbanApp projectId={7} projectSlug="proj" />);
    await waitFor(() => expect(mockBoardHolder.props).not.toBeNull());
}

describe("KanbanApp — transient NaN projectId tolerance", () => {
    it("defers ALL network + WS calls until projectId is finite", async () => {
        render(<KanbanApp projectId={NaN} projectSlug="proj" />);
        await new Promise((r) => setTimeout(r, 20));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.queryByTestId("board-stub")).toBeNull();
        expect(document.querySelector(".kanban-header")).not.toBeNull(); // chrome still renders
    });
});

describe("KanbanApp — is_kanban_activated module gate", () => {
    it("renders the permission-denied section and no board when the module is off", async () => {
        installFetch(makeProject({ is_kanban_activated: false }));
        render(<KanbanApp projectId={7} projectSlug="proj" />);
        await waitFor(() => expect(document.querySelector(".permission-denied")).not.toBeNull());
        expect(screen.queryByTestId("board-stub")).toBeNull();
    });
});

describe("KanbanApp — successful load", () => {
    it("issues project/userstories/swimlanes GETs and renders the board with loaded state", async () => {
        await renderLoaded();
        expect(screen.getByTestId("board-stub")).toBeInTheDocument();
        expect(findCall("/projects/7")).toBeTruthy();
        expect(findCall("/userstories")).toBeTruthy();
        expect(findCall("/swimlanes")).toBeTruthy();
        expect(mockBoardHolder.props!.state.usByStatus["1"]).toEqual([101, 102]);
    });

    it("passes the DISABLE_PAGINATION header on the userstories request", async () => {
        await renderLoaded();
        const call = findCall("/userstories")!;
        const headers = (call[1] as RequestInit).headers as Record<string, string>;
        const keys = Object.keys(headers).map((k) => k.toLowerCase());
        expect(keys.some((k) => k.indexOf("pagination") !== -1)).toBe(true);
    });
});

describe("KanbanApp — my_permissions gating", () => {
    it("sets canAddUs true when add_us is granted", async () => {
        await renderLoaded();
        expect(mockBoardHolder.props!.canAddUs).toBe(true);
    });
    it("sets canAddUs false when add_us is NOT granted", async () => {
        installFetch(makeProject({ my_permissions: ["view_us"] }));
        await renderLoaded();
        expect(mockBoardHolder.props!.canAddUs).toBe(false);
    });
});

describe("KanbanApp — drag-drop persistence via bulk_update_kanban_order", () => {
    const resolved = (containerKey: string): ResolvedDrop => ({
        origin: { containerKey: "1::-1", index: 1 },
        target: { containerKey, index: 0 },
        orderedIds: [102],
        draggedIds: [102],
    });

    it("posts project_id/status_id/bulk_userstories with swimlane_id OMITTED for the -1 sentinel and no neighbors", async () => {
        await renderLoaded();
        fetchMock.mockClear();
        await act(async () => {
            await mockBoardHolder.props!.persist(resolved("2::-1"), { previous: null, next: null });
        });
        const call = findCall("bulk_update_kanban_order")!;
        expect(call).toBeTruthy();
        const body = bodyOf(call);
        expect(body.project_id).toBe(7);
        expect(body.status_id).toBe(2);
        expect(body.bulk_userstories).toEqual([102]);
        expect(body).not.toHaveProperty("swimlane_id"); // -1 → null → omitted
        expect(body).not.toHaveProperty("after_userstory_id");
        expect(body).not.toHaveProperty("before_userstory_id");
    });

    it("includes swimlane_id when the target swimlane is a real (positive) id", async () => {
        await renderLoaded();
        fetchMock.mockClear();
        await act(async () => {
            await mockBoardHolder.props!.persist(resolved("2::50"), { previous: null, next: null });
        });
        const body = bodyOf(findCall("bulk_update_kanban_order")!);
        expect(body.swimlane_id).toBe(50);
    });

    it("sends after_userstory_id (and NOT before) when previous is set", async () => {
        await renderLoaded();
        fetchMock.mockClear();
        await act(async () => {
            await mockBoardHolder.props!.persist(resolved("1::-1"), { previous: 101, next: null });
        });
        const body = bodyOf(findCall("bulk_update_kanban_order")!);
        expect(body.after_userstory_id).toBe(101);
        expect(body).not.toHaveProperty("before_userstory_id");
    });

    it("sends before_userstory_id (and NOT after) when only next is set", async () => {
        await renderLoaded();
        fetchMock.mockClear();
        await act(async () => {
            await mockBoardHolder.props!.persist(resolved("1::-1"), { previous: null, next: 105 });
        });
        const body = bodyOf(findCall("bulk_update_kanban_order")!);
        expect(body.before_userstory_id).toBe(105);
        expect(body).not.toHaveProperty("after_userstory_id");
    });
});

describe("KanbanApp — bulk user-story creation", () => {
    it("opens the bulk lightbox and posts to bulk_create with swimlane_id:null", async () => {
        await renderLoaded();
        act(() => mockBoardHolder.props!.onAddUs?.("bulk", 1));
        const area = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
        expect(area.className).toContain("e2e-bulk-subjects");
        fireEvent.change(area, { target: { value: "Story A\nStory B" } });
        fetchMock.mockClear();
        await act(async () => {
            fireEvent.click(document.querySelector(".e2e-bulk-submit")!);
            await Promise.resolve();
        });
        const call = findCall("bulk_create")!;
        expect(call).toBeTruthy();
        const body = bodyOf(call);
        expect(body.project_id).toBe(7);
        expect(body.status_id).toBe(1);
        expect(body.bulk_stories).toContain("Story A");
        expect(body.swimlane_id).toBeNull();
    });
});

describe("KanbanApp — chrome controls", () => {
    it("renders the filter button, search input and 4 board-zoom radios", async () => {
        await renderLoaded();
        expect(document.querySelector(".btn-filter.e2e-open-filter")).not.toBeNull();
        expect(document.querySelector(".kanban-search.e2e-search")).not.toBeNull();
        expect(document.querySelectorAll(".board-zoom .zoom-radio input").length).toBe(4);
    });
    it("renders the section title as <header><h1><span>Kanban</span> (QA-VIS-01)", async () => {
        await renderLoaded();
        const h1 = document.querySelector(".kanban-header header h1");
        expect(h1).not.toBeNull();
        expect(h1!.querySelector("span")!.textContent).toBe("Kanban");
        // The old project-name div.main-title must be gone.
        expect(document.querySelector(".kanban-header .main-title")).toBeNull();
    });
    it("renders the board-zoom radio-pill control with a title and 4 labeled radios (QA-VIS-02)", async () => {
        await renderLoaded();
        expect(document.querySelector(".board-zoom .board-zoom-title")!.textContent).toBe("Zoom:");
        const labels = Array.from(
            document.querySelectorAll<HTMLElement>(".board-zoom .zoom-radio"),
        );
        expect(labels.map((l) => l.querySelector(".checkmark span")!.textContent)).toEqual([
            "Compact",
            "Default",
            "Detailed",
            "Expanded",
        ]);
        // Radios carry sequential 0-3 values and the current level is checked.
        const inputs = Array.from(
            document.querySelectorAll<HTMLInputElement>(".board-zoom .zoom-radio input[type='radio']"),
        );
        expect(inputs.map((i) => i.value)).toEqual(["0", "1", "2", "3"]);
        expect(inputs.filter((i) => i.checked).length).toBe(1);
    });
    it("renders the search inside <tg-input-search> with a magnifier, placeholder and aria-label (QA-VIS-04/A11Y-01)", async () => {
        await renderLoaded();
        const host = document.querySelector("tg-input-search");
        expect(host).not.toBeNull();
        const input = host!.querySelector("input.kanban-search") as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.getAttribute("type")).toBe("search");
        expect(input.getAttribute("placeholder")).toBe("subject or reference");
        expect(input.getAttribute("aria-label")).toBe("Search by subject or reference");
        expect(input.id).toBeTruthy();
        expect(input.getAttribute("name")).toBeTruthy();
        // The magnifier renders as the shared sprite icon inside the host.
        expect(host!.querySelector("svg.icon.icon-search")).not.toBeNull();
    });
    it("toggles the filter panel when the filter button is clicked", async () => {
        await renderLoaded();
        expect(document.querySelector(".kanban-filter")).toBeNull();
        fireEvent.click(document.querySelector(".btn-filter.e2e-open-filter")!);
        await waitFor(() => expect(document.querySelector(".kanban-filter")).not.toBeNull());
    });
});

describe("KanbanApp — pure helpers", () => {
    it("parseContainerKey handles the ::-1 sentinel and real swimlanes", () => {
        expect(parseContainerKey("5::-1")).toEqual({ statusId: 5, swimlaneId: -1 });
        expect(parseContainerKey("5::50")).toEqual({ statusId: 5, swimlaneId: 50 });
        expect(parseContainerKey("9")).toEqual({ statusId: 9, swimlaneId: -1 });
    });
    it("zoomKeysFor is cumulative and clamped 0..3", () => {
        expect(zoomKeysFor(0)).toEqual(["assigned_to", "ref"]);
        expect(zoomKeysFor(1)).toContain("subject");
        expect(zoomKeysFor(2)).toContain("tags");
        expect(zoomKeysFor(3)).toContain("attachments");
        expect(zoomKeysFor(99)).toEqual(zoomKeysFor(3));
        expect(zoomKeysFor(-5)).toEqual(zoomKeysFor(0));
    });
    it("resolveKanbanDrop returns null when the dragged card cannot be located", () => {
        const empty = { swimlanesList: [], usByStatus: {}, usByStatusSwimlanes: {} } as unknown as KanbanState;
        expect(resolveKanbanDrop(empty, { activeId: 999, overId: 1, event: {} as never })).toBeNull();
    });
});

describe("KanbanApp — WebSocket subscription (frozen routing keys)", () => {
    it("connects and subscribes to changes.project.{id}.userstories and .projects", async () => {
        await renderLoaded();
        expect(mockEvents.connected).toBe(true);
        expect(mockEvents.subs["changes.project.7.userstories"]).toBeDefined();
        expect(mockEvents.subs["changes.project.7.projects"]).toBeDefined();
    });

    it("reloads user stories when a userstories event arrives", async () => {
        await renderLoaded();
        fetchMock.mockClear();
        await act(async () => {
            mockEvents.subs["changes.project.7.userstories"]({});
            await Promise.resolve();
        });
        expect(findCall("/userstories")).toBeTruthy();
    });

    it("refreshes the whole board only for matching projects events", async () => {
        await renderLoaded();
        fetchMock.mockClear();
        await act(async () => {
            mockEvents.subs["changes.project.7.projects"]({ matches: "projects.swimlane" });
            await Promise.resolve();
        });
        expect(findCall("/projects/7")).toBeTruthy();

        fetchMock.mockClear();
        await act(async () => {
            mockEvents.subs["changes.project.7.projects"]({ matches: "something.unrelated" });
            await Promise.resolve();
        });
        expect(findCall("/projects/7")).toBeFalsy();
    });

    it("unsubscribes and disconnects on unmount", async () => {
        const { unmount } = render(<KanbanApp projectId={7} projectSlug="proj" />);
        await waitFor(() => expect(mockBoardHolder.props).not.toBeNull());
        unmount();
        expect(mockEvents.disconnected).toBe(true);
        expect(mockEvents.unsubscribed).toContain("changes.project.7.userstories");
    });
});

describe("KanbanApp — board callbacks", () => {
    it("folds a status column via onFoldStatus", async () => {
        await renderLoaded();
        act(() => mockBoardHolder.props!.onFoldStatus?.({ id: 1 }));
        await waitFor(() => expect(mockBoardHolder.props!.folds[1]).toBe(true));
    });

    it("toggles a swimlane via onToggleSwimlane", async () => {
        await renderLoaded();
        act(() => mockBoardHolder.props!.onToggleSwimlane?.(50));
        await waitFor(() => expect(mockBoardHolder.props!.foldedSwimlane[50]).toBe(true));
    });

    it("toggles a card fold via onToggleFold (state update, no throw)", async () => {
        await renderLoaded();
        act(() => mockBoardHolder.props!.onToggleFold?.(101));
        await waitFor(() => expect(mockBoardHolder.props!.state.foldStatusChanged[101]).toBe(true));
    });

    it("deletes a user story via onClickDelete when confirmed (DELETE /userstories/{id})", async () => {
        const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
        await renderLoaded();
        fetchMock.mockClear();
        await act(async () => {
            mockBoardHolder.props!.onClickDelete?.(101);
            await Promise.resolve();
        });
        const call = findCall("/userstories/101");
        expect(call).toBeTruthy();
        expect((call![1] as RequestInit).method).toBe("DELETE");
        confirmSpy.mockRestore();
    });

    it("does NOT delete when the confirm dialog is cancelled", async () => {
        const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
        await renderLoaded();
        fetchMock.mockClear();
        await act(async () => {
            mockBoardHolder.props!.onClickDelete?.(101);
            await Promise.resolve();
        });
        expect(findCall("/userstories/101")).toBeFalsy();
        confirmSpy.mockRestore();
    });

    it("exposes isArchivedHidden and showPlaceholder predicates", async () => {
        await renderLoaded();
        expect(typeof mockBoardHolder.props!.isArchivedHidden?.(101)).toBe("boolean");
        // board has loaded stories, so the empty-column placeholder is false
        expect(mockBoardHolder.props!.showPlaceholder?.(1, null)).toBe(false);
    });
});

describe("KanbanApp — zoom + search reloads", () => {
    it("re-fetches user stories with attachments/tasks when crossing into zoom level 3", async () => {
        await renderLoaded();
        fetchMock.mockClear();
        fireEvent.click(document.querySelectorAll(".board-zoom .zoom-radio input")[3]);
        await waitFor(() => expect(findCall("/userstories")).toBeTruthy());
        const call = findCall("/userstories")!;
        expect(String(call[0])).toContain("include_attachments");
    });

    it("debounces a search query into a reload with q=", async () => {
        jest.useFakeTimers();
        try {
            render(<KanbanApp projectId={7} projectSlug="proj" />);
            await waitFor(() => expect(mockBoardHolder.props).not.toBeNull());
            fetchMock.mockClear();
            fireEvent.change(document.querySelector(".kanban-search")!, { target: { value: "bug" } });
            expect(findCall("/userstories")).toBeFalsy(); // not yet — debounced
            await act(async () => {
                jest.advanceTimersByTime(250);
                await Promise.resolve();
            });
            const call = findCall("/userstories");
            expect(call).toBeTruthy();
            expect(String(call![0])).toContain("q=bug");
        } finally {
            jest.useRealTimers();
        }
    });
});
