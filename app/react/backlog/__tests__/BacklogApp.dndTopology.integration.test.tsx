/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * F-M5 — Drag-and-drop TOPOLOGY integration test for `BacklogApp`.
 *
 * The primary `BacklogApp.test.tsx` mocks BOTH `../../shared/dnd/DndProvider`
 * AND `../SprintList`, so it asserts BacklogApp's control flow but NEVER the
 * app-level render topology — specifically that the real `<SprintList>` (and
 * therefore every sprint drop target) is mounted INSIDE the real
 * `<DndProvider>`'s `<DndContext>`. A mutation that moved `<SprintList>` out of
 * the provider survives that suite.
 *
 * This spec closes that gap. It renders the REAL `BacklogApp` with the REAL
 * `DndProvider` and the REAL `SprintList`, and replaces ONLY the leaf
 * `../Sprint` card with a probe that calls `useDndMonitor`. `useDndMonitor`
 * throws ("must be used within a children of <DndContext>") when rendered
 * outside a `DndContext`, so:
 *   - SprintList inside DndProvider (correct)  -> probe mounts, test passes.
 *   - SprintList outside DndProvider (mutant)  -> probe throws during render,
 *     the render/act flush rejects, and the test FAILS.
 *
 * `useDraggable`/`useDroppable` (which the real `Sprint` uses) fall back to a
 * default context and do NOT throw outside a provider, which is exactly why the
 * monitor hook — not those — is the reliable topology probe.
 *
 * Everything that is NOT part of the topology under test (the shared API/events
 * adapters and the other presentational children) is mocked so no real
 * `fetch`/WebSocket is touched. `../../shared/dnd/DndProvider` and `../SprintList`
 * are deliberately NOT mocked.
 */

import { render } from "@testing-library/react";
import { useMemo } from "react";
import { useDndMonitor } from "@dnd-kit/core";

import { BacklogApp } from "../BacklogApp";
import type { Project, ProjectStats, Sprint, UserStory } from "../types";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const PROJECT_ID = 5;

/** modify_us + not archived => `isDragEnabled` true => DndProvider renders a real DndContext. */
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
    } as Project;
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
    } as ProjectStats;
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
    } as Sprint;
}

/* -------------------------------------------------------------------------- */
/* Mocks — everything EXCEPT DndProvider and SprintList (both kept REAL).      */
/* mock-prefixed so the ts-jest-hoisted jest.mock factories may reference them.*/
/* -------------------------------------------------------------------------- */

let currentProject: Project;
let currentStats: ProjectStats;
let currentOpenSprints: Sprint[];

const mkRes = <T,>(data: T) => ({ data, status: 200, headers: new Headers() });

const mockHttpGet = jest.fn((...args: readonly unknown[]) => {
    const path = String(args[0]);
    if (path.includes("/stats")) {
        return Promise.resolve(mkRes(currentStats));
    }
    if (path === `projects/${PROJECT_ID}`) {
        return Promise.resolve(mkRes(currentProject));
    }
    if (path === "userstories") {
        return Promise.resolve(mkRes([] as UserStory[]));
    }
    return Promise.resolve(mkRes({}));
});

jest.mock("../../shared/api/httpClient", () => {
    // Define HttpError INSIDE the factory: the factory is hoisted above the
    // module body, so it cannot reference an outer class declaration (TDZ).
    class HttpError extends Error {
        status: number;
        constructor(status: number, message = "http error") {
            super(message);
            this.name = "HttpError";
            this.status = status;
        }
    }
    return {
        httpGet: (...args: readonly unknown[]) => mockHttpGet(...args),
        httpPatch: jest.fn(() =>
            Promise.resolve({ data: {}, status: 200, headers: new Headers() }),
        ),
        httpDelete: jest.fn(() =>
            Promise.resolve({ data: undefined, status: 204, headers: new Headers() }),
        ),
        HttpError,
    };
});

jest.mock("../../shared/api/milestones", () => ({
    list: jest.fn((..._args: readonly unknown[]) =>
        Promise.resolve({
            milestones: currentOpenSprints,
            open: currentOpenSprints.length,
            closed: 0,
        }),
    ),
}));

// BacklogApp calls filtersData / bulkUpdateBacklogOrder / bulkUpdateMilestone;
// the REAL DndProvider additionally imports bulkUpdateBacklogOrder /
// bulkUpdateKanbanOrder from this module, so all four must be exported.
jest.mock("../../shared/api/userstories", () => ({
    filtersData: jest.fn(() => Promise.resolve({ data: {}, status: 200, headers: new Headers() })),
    bulkUpdateBacklogOrder: jest.fn(() =>
        Promise.resolve({ data: [], status: 200, headers: new Headers() }),
    ),
    bulkUpdateKanbanOrder: jest.fn(() =>
        Promise.resolve({ data: [], status: 200, headers: new Headers() }),
    ),
    bulkUpdateMilestone: jest.fn(() =>
        Promise.resolve({ data: undefined, status: 204, headers: new Headers() }),
    ),
}));

jest.mock("../../shared/events/websocket", () => ({
    createEventsClient: jest.fn(() => ({
        connect: jest.fn(),
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
        disconnect: jest.fn(),
    })),
}));

// Presentational children that are NOT part of the DnD topology under test.
jest.mock("../Burndown", () => ({ Burndown: () => null }));
jest.mock("../BacklogTable", () => ({ BacklogTable: () => null }));
jest.mock("../SprintEditLightbox", () => ({ SprintEditLightbox: () => null }));
jest.mock("../BulkUserStoriesLightbox", () => ({ BulkUserStoriesLightbox: () => null }));

// The ONLY topology probe: replace the leaf sprint card with a component that
// asserts (via useDndMonitor) that it is a descendant of a <DndContext>.
jest.mock("../Sprint", () => {
    const { useMemo: useMemoInner } = require("react");
    const { useDndMonitor: useMonitor } = require("@dnd-kit/core");
    return {
        Sprint: ({ sprint }: { sprint: { id: number } }) => {
            // Throws "must be used within a children of <DndContext>" if this
            // card is NOT rendered inside the DndProvider's context.
            useMonitor(useMemoInner(() => ({}), []));
            return <div data-testid="sprint-dnd-probe" data-sprint-id={sprint.id} />;
        },
    };
});

/* -------------------------------------------------------------------------- */
/* Sanity check on the probe mechanism itself (independent of BacklogApp).     */
/* -------------------------------------------------------------------------- */

function BareProbe(): JSX.Element {
    useDndMonitor(useMemo(() => ({}), []));
    return <div data-testid="bare-probe" />;
}

beforeEach(() => {
    currentProject = makeProject();
    currentStats = makeStats();
    currentOpenSprints = [makeSprint({ id: 10 }), makeSprint({ id: 11, name: "Sprint 2" })];
    mockHttpGet.mockClear();
});

test("useDndMonitor throws when rendered outside a DndContext (probe is binding)", () => {
    // Guards the probe itself: if this ever STOPS throwing, the topology
    // assertion below would become vacuous. React logs the boundary error via
    // console.error when the render throws; suppress ONLY that expected log so
    // this deliberate-throw test stays clean (and does not trip the global
    // console-error guard).
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
        expect(() => render(<BareProbe />)).toThrow(/within a children of <DndContext>/);
    } finally {
        spy.mockRestore();
    }
});

test("real SprintList (and its sprint drop targets) mount INSIDE the real DndProvider's DndContext", async () => {
    const { findAllByTestId, getAllByTestId } = render(
        <BacklogApp projectId={PROJECT_ID} projectSlug="my-project" />,
    );

    // The sprints load asynchronously; once the real SprintList renders the
    // (mocked) sprint cards, each probe's useDndMonitor runs. It only survives
    // because the card is a descendant of the DndProvider's DndContext.
    const probes = await findAllByTestId("sprint-dnd-probe");
    expect(probes.length).toBe(currentOpenSprints.length);
    expect(probes.length).toBeGreaterThanOrEqual(1);

    // Every probe carries its sprint id (proves they are the real SprintList's
    // per-sprint cards, not an incidental single node).
    const ids = getAllByTestId("sprint-dnd-probe")
        .map((n) => n.getAttribute("data-sprint-id"))
        .sort();
    expect(ids).toEqual(["10", "11"]);

    // NOTE ON BINDINGNESS: a mutation that moves <SprintList> OUTSIDE
    // <DndProvider> makes these (async-mounted) probes render outside the
    // DndContext; `useDndMonitor` then throws in its mount effect, which React
    // surfaces through the act() flush and fails this test rather than
    // resolving the query. Verified by reverting BacklogApp's render topology.
});
