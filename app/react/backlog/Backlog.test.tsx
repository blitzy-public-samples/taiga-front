/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link Backlog} — the top-level React reproduction of the
 * AngularJS `BacklogController` screen container (feature F-002). The rendered
 * DOM mirrors the legacy `backlog.jade` + `backlog-table.jade` + `addnewus.jade`
 * templates, so these tests assert on the exact class names, `data-*`/`ng-repeat`
 * attributes and copy that the (unchanged) compiled Taiga SCSS and the ported
 * Playwright/e2e selectors depend on. They contribute to the >= 70% line-coverage
 * gate enforced by `jest.config.js` for the new React code.
 *
 * Test seam (per the file's agent brief):
 *   - `./hooks/useBacklogStories` is MOCKED. The real hook spins up the API +
 *     WebSocket clients and owns all screen state; mocking it lets each test feed
 *     a fully controlled view-model (`vm`) and keeps the suite a deterministic,
 *     network-free DOM assertion of the CONTAINER.
 *   - `./lightboxes/CreateEditSprint` is MOCKED with a tiny stub that renders a
 *     queryable `[data-testid="sprint-lb"]` marker only while `open` — the sprint
 *     modal itself (form state, validation) is covered by its own suite.
 *   - `BacklogRow`, `SprintList`/`Sprint`/`SprintHeader` and `BurndownSummary`
 *     are kept REAL so the container's composition is genuinely exercised: the
 *     `.backlog-table-body > div[ng-repeat]` rows, the sidebar
 *     `div[tg-backlog-sprint="sprint"]` cards, and the `.summary .data .number`
 *     burndown figure are the ACTUAL child output, not stand-ins.
 *   - `@dnd-kit` is left REAL. Its `DndContext`/`SortableContext`/`useSortable`/
 *     `useDroppable` primitives render correctly under jsdom (they only need
 *     pointer geometry once a drag actually starts, which these DOM-only tests
 *     never trigger), exactly as the sibling `SprintList` suite relies on.
 *
 * Conventions (identical to the sibling React tests):
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — no `import React`.
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`jest`/`beforeEach`) — no
 *     `@jest/globals` import; the tsconfig `types` array ships `"jest"`.
 *   - `ts-jest` + `jsdom`; `@testing-library/jest-dom` matchers are registered by
 *     `jest.setup.ts` (`setupFilesAfterEnv`).
 *   - Strict TypeScript: the controlled view-model is built loosely (`any`) and
 *     handed to the mocked hook cast to its `BacklogVM` return type, so a test can
 *     freely mutate individual fields (permissions, lightbox flag, velocity) per
 *     case without re-satisfying the whole interface.
 */

import { render, fireEvent } from "@testing-library/react";
import { Backlog } from "./Backlog";
import { useBacklogStories } from "./hooks/useBacklogStories";
import type { BacklogVM } from "./hooks/useBacklogStories";
import type { MountContext } from "../shared/types";

// ---------------------------------------------------------------------------
// Module mocks
//
// NOTE ON ORDERING: `ts-jest` hoists every `jest.mock(...)` call above the
// imports above, so the mock factories below are registered BEFORE `./Backlog`
// (and its child imports) are evaluated. Keeping the imports first is the
// idiomatic, lint-friendly form and is functionally equivalent to importing
// `Backlog` after the mocks.
// ---------------------------------------------------------------------------

// The hook is the ONLY data/side-effect boundary of the screen; replacing it
// with a bare `jest.fn()` (whose return value each test configures via
// `mockReturnValue`) avoids referencing any out-of-scope variable inside the
// factory (which Jest's hoist guard forbids) while still letting tests drive the
// entire view-model.
jest.mock("./hooks/useBacklogStories", () => ({
  useBacklogStories: jest.fn(),
}));

// The sprint create/edit lightbox is heavy (its own form + validation module).
// Here it is reduced to a presence marker gated on `open`, so the container test
// can prove it is mounted with the right visibility without pulling the modal in.
jest.mock("./lightboxes/CreateEditSprint", () => ({
  CreateEditSprint: (props: { open: boolean }) =>
    props.open ? <div data-testid="sprint-lb" /> : null,
}));

/** Typed handle to the mocked hook so tests can set its return value. */
const mockUseBacklogStories = useBacklogStories as jest.MockedFunction<
  typeof useBacklogStories
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Mount context bridged from the `<tg-react-backlog>` custom element. */
const context: MountContext = {
  projectSlug: "proj",
  token: "t",
  sessionId: "s",
  apiUrl: "/api/v1/",
  eventsUrl: null,
  language: "en",
};

/**
 * The controlled view-model returned by the mocked hook. It is typed loosely
 * (`any`) on purpose: individual tests mutate single fields (`project.
 * my_permissions`, `sprintLightbox.open`, `displayVelocity`, …) BEFORE rendering,
 * and the mock returns this exact reference, so those mutations are reflected the
 * moment `<Backlog>` calls the hook. Rebuilt fresh in `beforeEach` so no per-test
 * mutation leaks into the next case.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vm: any;

/**
 * Build a complete, self-consistent Backlog view-model with every permission
 * granted, two backlog stories, one open sprint, and a burndown at 40% complete.
 *
 * Every field the real {@link BacklogVM} exposes is present so `<Backlog>` (and
 * its real children) render exactly as in production. Each action is a fresh
 * `jest.fn()` for per-test call assertions; `hasPermission` is a live predicate
 * over the CURRENT `vm.project.my_permissions` so the read-only test can revoke
 * permissions by reassigning that array. The `project` (and its `my_permissions`
 * array) is rebuilt on every call so a test that reassigns permissions cannot
 * corrupt a shared object.
 */
function makeVM() {
  return {
    // ---- state ----
    loading: false,
    project: {
      id: 7,
      slug: "proj",
      name: "My Project",
      my_permissions: [
        "modify_us",
        "add_us",
        "delete_us",
        "add_milestone",
        "view_milestones",
        "modify_milestone",
      ],
      is_kanban_activated: true,
      is_backlog_activated: true,
      i_am_admin: true,
      roles: [],
      points: [],
    },
    projectId: 7,
    userstories: [
      { id: 101, ref: 1, subject: "US one", status: 1, tags: [] },
      { id: 102, ref: 2, subject: "US two", status: 1, tags: [] },
    ],
    sprints: [
      {
        id: 3,
        name: "Sprint 1",
        estimated_start: "2020-01-10",
        estimated_finish: "2020-01-24",
        closed: false,
        user_stories: [],
        total_points: 20,
        closed_points: 5,
      },
    ],
    closedSprints: [],
    closedSprintsVisible: false,
    totalMilestones: 1,
    totalClosedMilestones: 0,
    totalUserStories: 2,
    currentSprint: null,
    stats: {
      total_points: 100,
      defined_points: 80,
      closed_points: 40,
      speed: 0,
      completedPercentage: 40,
    },
    showGraphPlaceholder: false,
    showTags: false,
    activeFilters: false,
    displayVelocity: false,
    forecastNewSprint: true,
    filterQ: "",
    selectedFilters: [],
    statuses: [
      { id: 1, name: "New", color: "#aaa", order: 1 },
      { id: 2, name: "Done", color: "#0f0", order: 2 },
    ],
    selectedUs: new Set<number>(),
    eventsConnected: false,
    apiClient: {},
    sprintLightbox: { open: false, mode: "create", sprint: null, lastSprint: null },
    // ---- actions ----
    hasPermission: jest.fn((perm: string) => vm.project.my_permissions.includes(perm)),
    isBacklogActivated: true,
    loadUserstories: jest.fn(),
    changeQ: jest.fn(),
    toggleShowTags: jest.fn(),
    toggleActiveFilters: jest.fn(),
    toggleVelocityForecasting: jest.fn(),
    toggleClosedSprints: jest.fn(),
    moveUs: jest.fn(),
    moveToSprint: jest.fn(),
    moveUsToTop: jest.fn(),
    updateUserStoryStatus: jest.fn(),
    updateUserStoryPoints: jest.fn(),
    deleteUserStory: jest.fn(),
    addNewUs: jest.fn(),
    editUserStory: jest.fn(),
    toggleSelectedUs: jest.fn(),
    moveSelectedToCurrentSprint: jest.fn(),
    moveSelectedToLatestSprint: jest.fn(),
    openCreateSprint: jest.fn(),
    openEditSprint: jest.fn(),
    closeSprintLightbox: jest.fn(),
    onSprintSaved: jest.fn(),
    onSprintDeleted: jest.fn(),
    createSprintFromForecasting: jest.fn(),
  };
}

/**
 * Render `<Backlog>` with the current `vm` (already installed as the mocked
 * hook's return value in `beforeEach`). Returns the full RTL result so tests can
 * use `container`/`rerender`.
 */
function renderBacklog() {
  return render(<Backlog context={context} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  vm = makeVM();
  mockUseBacklogStories.mockReturnValue(vm as BacklogVM);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Backlog — root shell", () => {
  it("renders the main.main.scrum container with section.backlog and sidebar.sidebar", () => {
    const { container } = renderBacklog();

    expect(container.querySelector("main.main.scrum")).toBeInTheDocument();
    expect(container.querySelector("section.backlog")).toBeInTheDocument();
    expect(container.querySelector("sidebar.sidebar")).toBeInTheDocument();
  });
});

describe("Backlog — header & story count", () => {
  it("renders the 'Backlog' title and the '<n> user stories' count when no filters are selected", () => {
    const { container } = renderBacklog();

    const title = container.querySelector(".backlog-header-title h2");
    expect(title).toBeInTheDocument();
    expect(title?.textContent).toBe("Backlog");

    // selectedFilters is empty -> single, unqualified count span.
    const count = container.querySelector(".backlog-stories-number");
    expect(count).toBeInTheDocument();
    expect(count?.textContent).toBe("2 user stories");
  });
});

describe("Backlog — add-user-story controls (addnewus.jade)", () => {
  it("renders exactly two .new-us anchors and wires them to addNewUs('standard'|'bulk')", () => {
    const { container } = renderBacklog();

    const anchors = container.querySelectorAll(".new-us a");
    expect(anchors).toHaveLength(2);

    // get(0) is the standard story button; get(1) is the bulk-add icon button.
    fireEvent.click(anchors[0]);
    expect(vm.addNewUs).toHaveBeenCalledWith("standard");

    fireEvent.click(anchors[1]);
    expect(vm.addNewUs).toHaveBeenCalledWith("bulk");
  });
});

describe("Backlog — backlog-table body rows (real BacklogRow)", () => {
  it("renders each story as a DIRECT .backlog-table-body > div[ng-repeat] child (SortableBacklogRow adds no wrapper node)", () => {
    const { container } = renderBacklog();

    const rows = container.querySelectorAll(".backlog-table-body > div[ng-repeat]");
    expect(rows).toHaveLength(2);
  });
});

describe("Backlog — show-tags toggle", () => {
  it("renders #show-tags and invokes vm.toggleShowTags on click", () => {
    const { container } = renderBacklog();

    const showTags = container.querySelector("#show-tags");
    expect(showTags).toBeInTheDocument();

    fireEvent.click(showTags as Element);
    expect(vm.toggleShowTags).toHaveBeenCalledTimes(1);
  });
});

describe("Backlog — move-to-sprint control", () => {
  it("renders the 'Move to latest Sprint' variant when there is no current sprint", () => {
    const { container } = renderBacklog();

    const moveBtn = container.querySelector(".e2e-move-to-sprint");
    expect(moveBtn).toBeInTheDocument();
    // currentSprint is null -> latest-sprint variant, not the current-sprint one.
    expect(moveBtn).toHaveClass("move-to-latest-sprint");
    expect(moveBtn?.textContent).toContain("Move to latest Sprint");
  });
});

describe("Backlog — velocity forecasting toggle", () => {
  it("renders .e2e-velocity-forecasting (stories present + add_milestone) and toggles it on click", () => {
    const { container } = renderBacklog();

    const velocityBtn = container.querySelector(".e2e-velocity-forecasting");
    expect(velocityBtn).toBeInTheDocument();

    fireEvent.click(velocityBtn as Element);
    expect(vm.toggleVelocityForecasting).toHaveBeenCalledTimes(1);
  });
});

describe("Backlog — sidebar sprint list (real SprintList)", () => {
  it("renders one open sprint card and the add-sprint control", () => {
    const { container } = renderBacklog();

    const sprintCards = container.querySelectorAll('div[tg-backlog-sprint="sprint"]');
    expect(sprintCards).toHaveLength(1);
    expect(sprintCards[0]).toHaveClass("sprint-open");

    // totalMilestones > 0 && add_milestone -> the header add-sprint button renders.
    expect(container.querySelector(".add-sprint")).toBeInTheDocument();
  });
});

describe("Backlog — burndown summary (real BurndownSummary)", () => {
  it("composes the real summary, whose .summary .data .number shows the completed percentage", () => {
    const { container } = renderBacklog();

    expect(container.querySelector(".backlog-summary")).toBeInTheDocument();

    const number = container.querySelector(".summary .data .number");
    expect(number).toBeInTheDocument();
    expect(number?.textContent).toBe("40%");
  });
});

describe("Backlog — sprint lightbox visibility", () => {
  it("mounts the sprint lightbox only when vm.sprintLightbox.open is true", () => {
    const { container, rerender } = renderBacklog();

    // Closed by default -> the mocked lightbox renders nothing.
    expect(container.querySelector('[data-testid="sprint-lb"]')).toBeNull();

    // Open it and re-render: the mock now emits its presence marker.
    vm.sprintLightbox.open = true;
    rerender(<Backlog context={context} />);
    expect(container.querySelector('[data-testid="sprint-lb"]')).toBeInTheDocument();
  });
});

describe("Backlog — permission gating (read-only member)", () => {
  it("hides add-us, velocity-forecasting and the draggable column for a view-only member", () => {
    // Revoke every mutating permission before render; hasPermission and the
    // container's addUs/modifyUs gates all read this same array.
    vm.project.my_permissions = ["view_us"];

    const { container } = renderBacklog();

    // add_us gone -> no new-us anchors.
    expect(container.querySelectorAll(".new-us a")).toHaveLength(0);
    // add_milestone gone -> no velocity forecasting button.
    expect(container.querySelector(".e2e-velocity-forecasting")).toBeNull();
    // modify_us gone -> the drag handle column is not rendered in the header row.
    expect(container.querySelector(".draggable-us-column")).toBeNull();
  });
});

describe("Backlog — velocity forecasting add-sprint row", () => {
  it("renders .e2e-velocity-forecasting-add and .e2e-sprint-name when displayVelocity is on", () => {
    vm.displayVelocity = true;

    const { container } = renderBacklog();

    expect(container.querySelector(".e2e-velocity-forecasting-add")).toBeInTheDocument();
    expect(container.querySelector(".e2e-sprint-name")).toBeInTheDocument();
  });
});

