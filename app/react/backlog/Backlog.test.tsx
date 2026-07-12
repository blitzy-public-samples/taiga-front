/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link Backlog} — the top-level React reproduction of the
 * AngularJS `BacklogController` screen container (`backlog.jade` +
 * `backlog-table.jade` + `addnewus.jade` + `mainTitle.jade`).
 *
 * The `useBacklogStories` hook and the four presentational children
 * (`BacklogRow`, `SprintList`, `BurndownSummary`, `CreateEditSprint`) are mocked
 * so these tests exercise the CONTAINER in isolation: the DOM/class hierarchy it
 * emits (which the unchanged Taiga SCSS + the ported Playwright/e2e selectors
 * depend on), its permission gating, and the wiring of every control to the
 * view-model action it invokes. They contribute to the >= 70% line-coverage gate
 * for the new React code.
 *
 * Conventions (identical to the sibling React tests):
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`jest`) — no
 *     `@jest/globals` import; the project ships `@types/jest` and lists `"jest"`
 *     in the tsconfig `types` array.
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — no `import React`.
 *   - `ts-jest` + `jsdom`; `@testing-library/jest-dom` matchers registered by
 *     `jest.setup.ts`.
 *   - Strict TypeScript: fixtures use `as unknown as <Type>` casts.
 */

import { render, fireEvent } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";
import { Backlog } from "./Backlog";
import { useBacklogStories } from "./hooks/useBacklogStories";
import type { BacklogVM } from "./hooks/useBacklogStories";
import type { MountContext, UserStory, Project, Milestone } from "../shared/types";

// ---------------------------------------------------------------------------
// Child + hook mocks
//
// The children are replaced with tiny stubs that emit a stable, queryable DOM
// marker. The `BacklogRow` stub reproduces the row root's tag/class + the static
// `ng-repeat` attribute (spread so the dashed name bypasses the JSX attribute
// type table) so the container test can assert the ported e2e selector
// `.backlog-table-body > div[ng-repeat]` and that rows are DIRECT children.
// ---------------------------------------------------------------------------
jest.mock("./BacklogRow", () => ({
  BacklogRow: (props: { us: { id: number } }) => (
    <div
      className="row us-item-row"
      data-id={props.us.id}
      {...{ "ng-repeat": "us in userstories" }}
    />
  ),
}));

jest.mock("./SprintList", () => ({
  SprintList: () => <div data-testid="sprint-list" />,
}));

jest.mock("./BurndownSummary", () => ({
  BurndownSummary: () => <div className="backlog-summary" data-testid="burndown-summary" />,
}));

jest.mock("./lightboxes/CreateEditSprint", () => ({
  CreateEditSprint: (props: { open: boolean }) => (
    <div data-testid="create-edit-sprint" data-open={String(props.open)} />
  ),
}));

jest.mock("./hooks/useBacklogStories", () => ({
  useBacklogStories: jest.fn(),
}));

const mockUseBacklogStories = useBacklogStories as jest.MockedFunction<
  typeof useBacklogStories
>;

// ---------------------------------------------------------------------------
// @dnd-kit stubs
//
// The real `@dnd-kit` primitives rely on pointer-event coordinate math that is
// unreliable to simulate in jsdom. To unit-test the container's `onDragEnd`
// drag-wiring deterministically (the dragula/dom-autoscroller replacement — the
// behavioural heart of this migration), the three `@dnd-kit` entry points are
// replaced with functional no-ops that PRESERVE the rendered DOM:
//   - `DndContext`     -> renders its children (no wrapper node) AND captures the
//                         `onDragEnd` callback into `mockCapturedOnDragEnd` so a
//                         test can invoke it with a synthetic `DragEndEvent`.
//   - `SortableContext`-> renders its children (no wrapper node).
//   - `useSortable`    -> returns inert refs/attributes/listeners.
//   - `CSS.Transform`  -> no-op transform serialiser.
// Because both context providers still render children verbatim and `BacklogRow`
// is itself mocked, every DOM/selector assertion in the other suites is
// unaffected. `import type { DragEndEvent }` is erased at compile time, so it is
// unaffected by the runtime mock.
// ---------------------------------------------------------------------------
let mockCapturedOnDragEnd: ((event: DragEndEvent) => void) | undefined;

jest.mock("@dnd-kit/core", () => ({
  DndContext: (props: { children?: unknown; onDragEnd?: unknown }) => {
    mockCapturedOnDragEnd = props.onDragEnd as ((event: unknown) => void) | undefined;
    return props.children as JSX.Element;
  },
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
  closestCenter: () => [],
}));

jest.mock("@dnd-kit/sortable", () => ({
  SortableContext: (props: { children?: unknown }) => props.children as JSX.Element,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    setNodeRef: () => undefined,
    setActivatorNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    attributes: {},
    listeners: {},
    isDragging: false,
  }),
}));

jest.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Mount context bridged from the `<tg-react-backlog>` custom element. */
const context: MountContext = {
  projectSlug: "proj",
  token: "jwt-token",
  sessionId: "session-1",
  apiUrl: "http://localhost:9000/api/v1",
  eventsUrl: null,
  language: "en",
};

/** Project with every relevant permission granted. */
const baseProject: Project = {
  id: 7,
  slug: "proj",
  name: "My Project",
  my_permissions: ["modify_us", "add_us", "add_milestone", "view_us"],
  is_kanban_activated: true,
  is_backlog_activated: true,
} as unknown as Project;

/** Build a minimal user story fixture. */
function story(id: number): UserStory {
  return {
    id,
    ref: id,
    subject: "US " + id,
    status: 1,
    swimlane: null,
  } as unknown as UserStory;
}

/**
 * Build a complete {@link BacklogVM}, layering `overrides` over sensible
 * defaults. Every action is a fresh `jest.fn()` so a test can assert on the
 * exact call. `hasPermission` defaults to `false` (tests that need the
 * `add_milestone` branch opt in explicitly).
 *
 * @param overrides - Partial view-model to merge over the defaults.
 */
function makeVM(overrides: Partial<BacklogVM> = {}): BacklogVM {
  const base: BacklogVM = {
    // ---- state ----
    loading: false,
    project: baseProject,
    projectId: 7,
    userstories: [],
    sprints: [],
    closedSprints: [],
    closedSprintsVisible: false,
    totalMilestones: 0,
    totalClosedMilestones: 0,
    totalUserStories: 0,
    currentSprint: null,
    stats: null,
    showGraphPlaceholder: false,
    showTags: false,
    activeFilters: false,
    displayVelocity: false,
    forecastNewSprint: false,
    filterQ: "",
    selectedFilters: [],
    statuses: [],
    selectedUs: new Set<number>(),
    eventsConnected: false,
    sprintLightbox: { open: false, mode: "create", sprint: null, lastSprint: null },
    apiClient: {} as unknown as BacklogVM["apiClient"],
    // ---- actions ----
    hasPermission: jest.fn().mockReturnValue(false),
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
  return { ...base, ...overrides };
}

/** Render <Backlog> with the supplied view-model returned by the mocked hook. */
function renderBacklog(vm: BacklogVM) {
  mockUseBacklogStories.mockReturnValue(vm);
  return render(<Backlog context={context} />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Backlog — shell & loading guard", () => {
  it("renders the main.main.scrum > section.backlog shell", () => {
    const { container } = renderBacklog(makeVM());
    expect(container.querySelector("main.main.scrum")).toBeInTheDocument();
    expect(container.querySelector("section.backlog")).toBeInTheDocument();
  });

  it("renders a minimal main.main.scrum skeleton (no content) while project is null", () => {
    const { container } = renderBacklog(makeVM({ project: null }));
    expect(container.querySelector("main.main.scrum")).toBeInTheDocument();
    expect(container.querySelector("section.backlog")).not.toBeInTheDocument();
    expect(container.querySelector(".backlog-table")).not.toBeInTheDocument();
    expect(container.querySelector("sidebar.sidebar")).not.toBeInTheDocument();
  });

  it("shows the project name in the header h1 (text node — escaped by React)", () => {
    const { container } = renderBacklog(
      makeVM({ project: { ...baseProject, name: "Alpha & <b>" } as unknown as Project }),
    );
    const h1 = container.querySelector("section.backlog > header h1");
    expect(h1?.textContent).toBe("Alpha & <b>");
  });

  it("renders BurndownSummary, the sidebar SprintList, and CreateEditSprint", () => {
    const { container, getByTestId } = renderBacklog(makeVM());
    expect(getByTestId("burndown-summary")).toBeInTheDocument();
    const sidebar = container.querySelector("sidebar.sidebar");
    expect(sidebar).toBeInTheDocument();
    expect(sidebar?.querySelector("[data-testid='sprint-list']")).toBeInTheDocument();
    expect(getByTestId("create-edit-sprint")).toBeInTheDocument();
  });
});

describe("Backlog — new-us (add story) controls", () => {
  it("renders two anchors (standard + bulk) when add_us is granted", () => {
    const { container } = renderBacklog(makeVM());
    const anchors = container.querySelectorAll(".new-us a");
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toHaveClass("btn-small");
    expect(anchors[1]).toHaveClass("btn-icon");
    expect(anchors[1].getAttribute("aria-label")).toBe("Add some new user stories in bulk");
  });

  it("renders no anchors when add_us is absent", () => {
    const { container } = renderBacklog(
      makeVM({ project: { ...baseProject, my_permissions: ["view_us"] } as unknown as Project }),
    );
    expect(container.querySelectorAll(".new-us a")).toHaveLength(0);
  });

  it("fires addNewUs('standard') and addNewUs('bulk') on the respective anchors", () => {
    const vm = makeVM();
    const { container } = renderBacklog(vm);
    const anchors = container.querySelectorAll(".new-us a");
    fireEvent.click(anchors[0]);
    expect(vm.addNewUs).toHaveBeenCalledWith("standard");
    fireEvent.click(anchors[1]);
    expect(vm.addNewUs).toHaveBeenCalledWith("bulk");
  });
});

describe("Backlog — filters, search & tags toggle", () => {
  it("shows the 'Filters' label and toggles active filters on click", () => {
    const vm = makeVM();
    const { container } = renderBacklog(vm);
    const btn = container.querySelector("#show-filters-button") as HTMLElement;
    expect(btn).toHaveClass("e2e-open-filter");
    expect(btn.querySelector("span.text")?.textContent).toBe("Filters");
    expect(container.querySelector("#backlog-filter")).not.toBeInTheDocument();
    fireEvent.click(btn);
    expect(vm.toggleActiveFilters).toHaveBeenCalledTimes(1);
  });

  it("shows 'Hide filters' + active class + the filter panel when activeFilters is true", () => {
    const { container } = renderBacklog(makeVM({ activeFilters: true }));
    const btn = container.querySelector("#show-filters-button") as HTMLElement;
    expect(btn).toHaveClass("active");
    expect(btn.querySelector("span.text")?.textContent).toBe("Hide filters");
    expect(container.querySelector("#backlog-filter")).toBeInTheDocument();
  });

  it("renders a selected-filters badge with the filter count", () => {
    const { container } = renderBacklog(makeVM({ selectedFilters: ["a", "b"] }));
    expect(container.querySelector(".selected-filters")?.textContent).toBe("2");
  });

  it("routes the search input value to changeQ", () => {
    const vm = makeVM();
    const { container } = renderBacklog(vm);
    const input = container.querySelector("input.e2e-search") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "login" } });
    expect(vm.changeQ).toHaveBeenCalledWith("login");
  });

  it("shows #show-tags only when there are stories, and toggles tags on click", () => {
    const empty = renderBacklog(makeVM());
    expect(empty.container.querySelector("#show-tags")).not.toBeInTheDocument();
    empty.unmount();

    const vm = makeVM({ userstories: [story(1)], totalUserStories: 1 });
    const { container } = renderBacklog(vm);
    const tags = container.querySelector("#show-tags") as HTMLElement;
    expect(tags).toHaveClass("display-tags-button");
    // showTags defaults to false in this VM -> the checkbox reflects that.
    expect(container.querySelector("#show-tags-input")).not.toBeChecked();
    fireEvent.click(tags);
    expect(vm.toggleShowTags).toHaveBeenCalledTimes(1);
  });
});

describe("Backlog — move-to-sprint control", () => {
  it("renders the 'latest' variant when there is no current sprint", () => {
    const vm = makeVM();
    const { container } = renderBacklog(vm);
    const btn = container.querySelector(".e2e-move-to-sprint") as HTMLElement;
    expect(btn).toHaveClass("move-to-latest-sprint");
    expect(btn.getAttribute("id")).toBe("move-to-latest-sprint");
    fireEvent.click(btn);
    expect(vm.moveSelectedToLatestSprint).toHaveBeenCalledTimes(1);
    expect(vm.moveSelectedToCurrentSprint).not.toHaveBeenCalled();
  });

  it("renders the 'current' variant when a current sprint exists", () => {
    const vm = makeVM({ currentSprint: { id: 9, name: "Sprint 1" } as unknown as Milestone });
    const { container } = renderBacklog(vm);
    const btn = container.querySelector(".e2e-move-to-sprint") as HTMLElement;
    expect(btn).toHaveClass("move-to-current-sprint");
    expect(btn.getAttribute("id")).toBe("move-to-current-sprint");
    fireEvent.click(btn);
    expect(vm.moveSelectedToCurrentSprint).toHaveBeenCalledTimes(1);
  });
});

describe("Backlog — velocity forecasting", () => {
  it("renders the toggle (gated on add_milestone) and toggles on click", () => {
    const vm = makeVM({ userstories: [story(1)], totalUserStories: 1 });
    (vm.hasPermission as jest.Mock).mockReturnValue(true);
    const { container } = renderBacklog(vm);
    const btn = container.querySelector(".e2e-velocity-forecasting") as HTMLElement;
    expect(btn).toBeInTheDocument();
    expect(btn.querySelector("span.text")?.textContent).toBe("Velocity forecasting");
    fireEvent.click(btn);
    expect(vm.toggleVelocityForecasting).toHaveBeenCalledTimes(1);
  });

  it("hides the toggle when add_milestone is not granted", () => {
    const vm = makeVM({ userstories: [story(1)], totalUserStories: 1 });
    (vm.hasPermission as jest.Mock).mockReturnValue(false);
    const { container } = renderBacklog(vm);
    expect(container.querySelector(".e2e-velocity-forecasting")).not.toBeInTheDocument();
  });

  it("adds the 'active' class to the toggle when displayVelocity is true", () => {
    const vm = makeVM({ userstories: [story(1)], totalUserStories: 1, displayVelocity: true });
    (vm.hasPermission as jest.Mock).mockReturnValue(true);
    const { container } = renderBacklog(vm);
    expect(container.querySelector(".e2e-velocity-forecasting")).toHaveClass("active");
  });

  it("renders forecasting-add-sprint (with e2e-sprint-name) when displayVelocity; click creates a sprint", () => {
    const vm = makeVM({ userstories: [story(1)], totalUserStories: 1, displayVelocity: true });
    (vm.hasPermission as jest.Mock).mockReturnValue(true);
    const { container } = renderBacklog(vm);
    const add = container.querySelector(".e2e-velocity-forecasting-add") as HTMLElement;
    expect(add).toBeInTheDocument();
    expect(container.querySelector("input.e2e-sprint-name")).toBeInTheDocument();
    fireEvent.click(add);
    expect(vm.createSprintFromForecasting).toHaveBeenCalledTimes(1);
  });

  it("shows the 'create sprint and add US' text when forecastNewSprint is true", () => {
    const vm = makeVM({
      userstories: [story(1)],
      totalUserStories: 1,
      displayVelocity: true,
      forecastNewSprint: true,
    });
    (vm.hasPermission as jest.Mock).mockReturnValue(true);
    const { container } = renderBacklog(vm);
    expect(container.querySelector(".forecasting-text")?.textContent).toBe(
      "create sprint and add US",
    );
  });
});

describe("Backlog — story count text", () => {
  it("shows the unfiltered total when no filters are selected", () => {
    const { container } = renderBacklog(makeVM({ totalUserStories: 5 }));
    const nums = container.querySelectorAll(".backlog-stories-number");
    expect(nums).toHaveLength(1);
    expect(nums[0].textContent).toBe("5 user stories");
  });

  it("shows the squared count + 'of N user stories' when filters are selected", () => {
    const { container } = renderBacklog(
      makeVM({
        userstories: [story(1), story(2)],
        totalUserStories: 9,
        selectedFilters: ["status"],
      }),
    );
    const nums = container.querySelectorAll(".backlog-stories-number");
    expect(nums[0]).toHaveClass("squared");
    expect(nums[0].textContent).toBe("2");
    expect(nums[1].textContent).toBe("of 9 user stories");
  });
});

describe("Backlog — table header title row", () => {
  it("includes the draggable + input columns when modify_us is granted", () => {
    const { container } = renderBacklog(makeVM({ userstories: [story(1)], totalUserStories: 1 }));
    const title = container.querySelector(".backlog-table-title") as HTMLElement;
    expect(title.querySelector(".draggable-us-column")).toBeInTheDocument();
    expect(title.querySelector(".input")).toBeInTheDocument();
    expect(title.querySelector(".user-stories")?.textContent).toBe("User Story");
    expect(title.querySelector(".status")?.textContent).toBe("Status");
    expect(title.querySelector(".points")?.getAttribute("title")).toBe("Select view per Role");
    expect(title.querySelector(".header-points")?.textContent).toBe("Points");
  });

  it("omits the draggable + input columns when modify_us is absent", () => {
    const { container } = renderBacklog(
      makeVM({
        userstories: [story(1)],
        totalUserStories: 1,
        project: { ...baseProject, my_permissions: ["view_us"] } as unknown as Project,
      }),
    );
    const title = container.querySelector(".backlog-table-title") as HTMLElement;
    expect(title.querySelector(".draggable-us-column")).not.toBeInTheDocument();
    expect(title.querySelector(".input")).not.toBeInTheDocument();
  });
});

describe("Backlog — table body modifiers & rows", () => {
  it("applies the show-tags / active-filters / forecasted-stories modifier classes", () => {
    const vm = makeVM({
      userstories: [story(1)],
      totalUserStories: 1,
      showTags: true,
      activeFilters: true,
      displayVelocity: true,
    });
    (vm.hasPermission as jest.Mock).mockReturnValue(true);
    const { container } = renderBacklog(vm);
    const body = container.querySelector(".backlog-table-body") as HTMLElement;
    expect(body).toHaveClass("show-tags");
    expect(body).toHaveClass("active-filters");
    expect(body).toHaveClass("forecasted-stories");
  });

  it("renders each story as a DIRECT child of .backlog-table-body preserving [ng-repeat]", () => {
    const { container } = renderBacklog(
      makeVM({ userstories: [story(1), story(2), story(3)], totalUserStories: 3 }),
    );
    expect(container.querySelectorAll(".backlog-table-body > .us-item-row")).toHaveLength(3);
    expect(container.querySelectorAll(".backlog-table-body > div[ng-repeat]")).toHaveLength(3);
  });

  it("adds 'hidden' to the inner section.backlog-table only when there are no stories", () => {
    const empty = renderBacklog(makeVM({ userstories: [] }));
    expect(
      empty.container.querySelector(".backlog-manager section.backlog-table"),
    ).toHaveClass("hidden");
    empty.unmount();

    const { container } = renderBacklog(makeVM({ userstories: [story(1)], totalUserStories: 1 }));
    expect(
      container.querySelector(".backlog-manager section.backlog-table"),
    ).not.toHaveClass("hidden");
  });
});

describe("Backlog — empty states", () => {
  it("shows empty-large (visible) when there are no stories and no query", () => {
    const { container } = renderBacklog(makeVM({ userstories: [], filterQ: "" }));
    const large = container.querySelector(".empty-large") as HTMLElement;
    const noMatch = container.querySelector(".empty-backlog") as HTMLElement;
    expect(large).not.toHaveClass("hidden");
    expect(noMatch).toHaveClass("hidden");
    expect(large.querySelector(".title")?.textContent).toBe("The backlog is empty!");
    // add_us is granted -> the create button is shown
    expect(large.querySelector("button.btn-small")).toBeInTheDocument();
  });

  it("shows empty-backlog (No matches, visible) when a query yields no stories", () => {
    const { container } = renderBacklog(makeVM({ userstories: [], filterQ: "xyz" }));
    const large = container.querySelector(".empty-large") as HTMLElement;
    const noMatch = container.querySelector(".empty-backlog") as HTMLElement;
    expect(noMatch).not.toHaveClass("hidden");
    expect(large).toHaveClass("hidden");
    expect(noMatch.querySelector(".no-match")?.textContent).toBe("No matches");
  });

  it("hides both empty states when stories exist", () => {
    const { container } = renderBacklog(makeVM({ userstories: [story(1)], totalUserStories: 1 }));
    expect(container.querySelector(".empty-large")).toHaveClass("hidden");
    expect(container.querySelector(".empty-backlog")).toHaveClass("hidden");
  });

  it("omits the empty-large create button when add_us is not granted", () => {
    const { container } = renderBacklog(
      makeVM({
        userstories: [],
        filterQ: "",
        project: { ...baseProject, my_permissions: ["view_us"] } as unknown as Project,
      }),
    );
    expect(container.querySelector(".empty-large button.btn-small")).not.toBeInTheDocument();
  });

  it("fires addNewUs('standard') from the empty-large create button when add_us is granted", () => {
    const vm = makeVM({ userstories: [], filterQ: "" });
    const { container } = renderBacklog(vm);
    const createBtn = container.querySelector(".empty-large button.btn-small") as HTMLElement;
    expect(createBtn).toBeInTheDocument();
    fireEvent.click(createBtn);
    expect(vm.addNewUs).toHaveBeenCalledWith("standard");
  });
});

describe("Backlog — tg-svg icon wrappers (SCSS parity)", () => {
  it("wraps header/menu icons in <tg-svg> so descendant selectors apply", () => {
    const vm = makeVM({ userstories: [story(1)], totalUserStories: 1 });
    (vm.hasPermission as jest.Mock).mockReturnValue(true);
    const { container } = renderBacklog(vm);
    // filter button icon
    expect(
      container.querySelector("#show-filters-button tg-svg svg.icon.icon-filters"),
    ).toBeInTheDocument();
    // move-to-sprint icon (SCSS targets `.btn-filter.move-to-sprint tg-svg`)
    expect(
      container.querySelector(".move-to-sprint tg-svg svg.icon.icon-add-to-sprint"),
    ).toBeInTheDocument();
    // add-story anchor icon
    expect(
      container.querySelector(".new-us a.btn-small tg-svg svg.icon.icon-add"),
    ).toBeInTheDocument();
  });
});

describe("Backlog — loading placeholder", () => {
  it("renders the tg-loading placeholder text while loading", () => {
    const { container } = renderBacklog(
      makeVM({ userstories: [story(1)], totalUserStories: 1, loading: true }),
    );
    const body = container.querySelector(".backlog-table-body") as HTMLElement;
    // last child div holds the ellipsis loader when loading
    expect(body.textContent).toContain("…");
  });
});

// ---------------------------------------------------------------------------
// onDragEnd drag-wiring (dragula + dom-autoscroller replacement)
//
// These exercise the container's single `onDragEnd` handler directly (captured
// from the stubbed `DndContext`), mapping each `@dnd-kit` drop outcome to the
// exact view-model action the legacy `tgBacklogSortable` drake fired:
//   - drop onto a sprint droppable   -> `moveToSprint([us], sprintId)`
//                                        (=> bulk-update-us-milestone)
//   - drop over another backlog row  -> `moveUs([us], newIndex, null, prev, next)`
//                                        (=> bulk-update-us-backlog-order)
//   - no target / unknown / self     -> no-op
// The previous/next neighbour computation mirrors `sortable.coffee` (the drop
// target's siblings become `previousUs`/`nextUs`).
// ---------------------------------------------------------------------------
describe("Backlog — onDragEnd (drag wiring)", () => {
  /** Render the container and return the `onDragEnd` captured from DndContext. */
  function getOnDragEnd(vm: BacklogVM): (event: DragEndEvent) => void {
    renderBacklog(vm);
    if (!mockCapturedOnDragEnd) {
      throw new Error("DndContext onDragEnd was not captured");
    }
    return mockCapturedOnDragEnd;
  }

  it("moves the story to a sprint when dropped on a sprint droppable", () => {
    const us1 = story(1);
    const vm = makeVM({ userstories: [us1, story(2)], totalUserStories: 2 });
    const onDragEnd = getOnDragEnd(vm);

    onDragEnd({
      active: { id: 1 },
      over: { id: "sprint-9", data: { current: { type: "sprint", sprintId: 9 } } },
    } as unknown as DragEndEvent);

    expect(vm.moveToSprint).toHaveBeenCalledWith([us1], 9);
    expect(vm.moveUs).not.toHaveBeenCalled();
  });

  it("reorders within the backlog when dropped over a later row (prev set, next null)", () => {
    const us1 = story(1);
    const us2 = story(2);
    const us3 = story(3);
    const vm = makeVM({ userstories: [us1, us2, us3], totalUserStories: 3 });
    const onDragEnd = getOnDragEnd(vm);

    // Drop story 1 over story 3 (index 2): previous = us2, next = none.
    onDragEnd({
      active: { id: 1 },
      over: { id: 3, data: { current: undefined } },
    } as unknown as DragEndEvent);

    expect(vm.moveUs).toHaveBeenCalledWith([us1], 2, null, us2, null);
    expect(vm.moveToSprint).not.toHaveBeenCalled();
  });

  it("reorders to the first position (prev null, next set)", () => {
    const us1 = story(1);
    const us2 = story(2);
    const vm = makeVM({ userstories: [us1, us2], totalUserStories: 2 });
    const onDragEnd = getOnDragEnd(vm);

    // Drop story 2 over story 1 (index 0): previous = none, next = us2.
    onDragEnd({
      active: { id: 2 },
      over: { id: 1, data: { current: undefined } },
    } as unknown as DragEndEvent);

    expect(vm.moveUs).toHaveBeenCalledWith([us2], 0, null, null, us2);
  });

  it("string/number id coercion still resolves the dragged story", () => {
    const us1 = story(1);
    const us2 = story(2);
    const vm = makeVM({ userstories: [us1, us2], totalUserStories: 2 });
    const onDragEnd = getOnDragEnd(vm);

    // @dnd-kit may surface ids as strings; the handler compares via String().
    onDragEnd({
      active: { id: "1" },
      over: { id: "2", data: { current: undefined } },
    } as unknown as DragEndEvent);

    expect(vm.moveUs).toHaveBeenCalledWith([us1], 1, null, us1, null);
  });

  it("is a no-op when there is no drop target", () => {
    const vm = makeVM({ userstories: [story(1)], totalUserStories: 1 });
    const onDragEnd = getOnDragEnd(vm);

    onDragEnd({ active: { id: 1 }, over: null } as unknown as DragEndEvent);

    expect(vm.moveUs).not.toHaveBeenCalled();
    expect(vm.moveToSprint).not.toHaveBeenCalled();
  });

  it("is a no-op when the dragged story id is unknown", () => {
    const vm = makeVM({ userstories: [story(1)], totalUserStories: 1 });
    const onDragEnd = getOnDragEnd(vm);

    onDragEnd({
      active: { id: 999 },
      over: { id: 1, data: { current: undefined } },
    } as unknown as DragEndEvent);

    expect(vm.moveUs).not.toHaveBeenCalled();
    expect(vm.moveToSprint).not.toHaveBeenCalled();
  });

  it("is a no-op when a row is dropped onto itself", () => {
    const vm = makeVM({ userstories: [story(1), story(2)], totalUserStories: 2 });
    const onDragEnd = getOnDragEnd(vm);

    onDragEnd({
      active: { id: 1 },
      over: { id: 1, data: { current: undefined } },
    } as unknown as DragEndEvent);

    expect(vm.moveUs).not.toHaveBeenCalled();
    expect(vm.moveToSprint).not.toHaveBeenCalled();
  });

  it("ignores a sprint-typed drop that carries no sprintId (falls through, no match)", () => {
    const vm = makeVM({ userstories: [story(1)], totalUserStories: 1 });
    const onDragEnd = getOnDragEnd(vm);

    // type === "sprint" but sprintId == null -> not a sprint move; and the over
    // id matches no row -> no reorder either.
    onDragEnd({
      active: { id: 1 },
      over: { id: "sprint-x", data: { current: { type: "sprint" } } },
    } as unknown as DragEndEvent);

    expect(vm.moveToSprint).not.toHaveBeenCalled();
    expect(vm.moveUs).not.toHaveBeenCalled();
  });
});
